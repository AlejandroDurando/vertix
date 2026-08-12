import type {
  CondicionIva,
  CostoSimulador,
  InstrumentoCheque,
  ModalidadCheque,
  SimuladorChequesInput,
  SimuladorChequesOutput,
  SimuladorPrestamosInput,
  SimuladorPrestamosOutput,
  Tasas,
  TipoPersona,
} from "@/types";
import { describirTramo, tramoParaOperacion } from "./tasas";
import {
  diasCalendarioEntre,
  diasHabilesEntre,
  esDiaHabil,
  hoy,
  parseISODate,
  sumarDiasHabiles,
  toISODate,
} from "./fechas";

// Las tasas de la hoja se interpretan como TNA (Tasa Nominal Anual) en %.
const DIAS_ANIO = 365;

// Los derechos de mercado se prorratean sobre 90 días: por encima se cobran
// enteros (fórmula de la planilla de cotización).
const DIAS_DERECHOS = 90;

/**
 * Por debajo de este plazo, un cheque negociado fuera del mercado de capitales
 * paga el impuesto al cheque aparte: el interés de tan pocos días no alcanza a
 * cubrirlo. Más allá queda absorbido por la tasa (confirmado el 07/08/2026).
 */
export const DIAS_HABILES_IMPUESTO_CHEQUE = 10;

// La leyenda de aprobación crediticia y gastos de sellados corresponde sólo a
// préstamos: se quitó de acá por pedido del cliente (25/07/2026).
const DISCLAIMER_CHEQUES =
  "Cotización orientativa, calculada hasta la fecha estimada de acreditación (2 o 3 días hábiles posteriores a la fecha de pago), por lo que el resultado puede diferir. El desglose incluye el arancel de Vertix y los derechos e impuestos que se le cobran al vendedor según la modalidad. La tasa puede variar.";

/**
 * Cuándo se cobra el valor.
 *
 * El cheque y el echeq se acreditan 2 días hábiles después de la fecha de pago
 * (3 si cae en fin de semana o feriado), verificado contra la planilla de
 * cotización. La **FCE cobra a +1 día hábil**, confirmado con un boleto real de
 * AdCap el 07/08/2026: vencimiento 14/09 (lunes) → cobro 15/09.
 */
export function fechaAcreditacionEstimada(
  fechaPago: Date,
  instrumento: InstrumentoCheque = "cheque"
): Date {
  const habiles = instrumento === "fce" ? 1 : 2;
  return sumarDiasHabiles(fechaPago, esDiaHabil(fechaPago) ? habiles : habiles + 1);
}

/**
 * Desde cuándo corren los intereses.
 *
 * La FCE se liquida a 24hs: el vendedor cobra el día hábil siguiente al de la
 * operación, así que el plazo arranca ahí (boleto 348.884: concertación 10/08,
 * liquidación 11/08, cobro 15/09 = 35 días). El cheque descuenta desde el día
 * de la venta, como en la planilla de cotización.
 */
function fechaDesde(ahora: Date, instrumento: InstrumentoCheque): Date {
  return instrumento === "fce" ? sumarDiasHabiles(ahora, 1) : ahora;
}

const DISCLAIMER_PRESTAMOS =
  "Cotización orientativa. La tasa final depende de la evaluación crediticia del solicitante y de condiciones de mercado (tasas de caución e intereses bancarios), por eso se muestra un rango. No incluye impuestos ni otros gastos propios del crédito a otorgar (sellados, certificación de firmas, etc.). El otorgamiento depende de aprobación crediticia.";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Porcentaje con coma decimal, como se escribe en castellano. */
const pct = (n: number) => `${String(n).replace(".", ",")}%`;

/**
 * Desglose de lo que se le descuenta al vendedor, replicando la planilla de
 * cotización real ("compra CPD PESOS", 06/08/2026).
 *
 * El interés es un **descuento racional**: se despeja el valor presente
 * (`V − V/(1 + i·d/365)`), no se aplica la tasa sobre el nominal. El arancel,
 * en cambio, sí se calcula sobre el nominal y prorrateado por días.
 *
 * En el mercado de capitales se suman el IVA del arancel, los derechos de
 * mercado con su IVA y la percepción de IVA sobre el interés. **La FCE es la
 * excepción**: paga derechos pero no lleva IVA ni percepción (confirmado por
 * AdCap y verificado contra el boleto 348.884 el 07/08/2026). Fuera del
 * mercado no hay derechos ni percepción, pero sí IVA sobre los gastos y el
 * impuesto al cheque cuando el plazo es corto.
 */
function calcularCostos(opts: {
  monto: number;
  dias: number;
  diasHabilesAlPago: number;
  tnaInteres: number;
  arancelPct: number;
  modalidad: ModalidadCheque;
  instrumento: InstrumentoCheque;
  condicionComprador: CondicionIva;
  tasas: Tasas;
}): { costos: CostoSimulador[]; incluyePercepcion: boolean } {
  const { monto, dias, tnaInteres, arancelPct, modalidad, instrumento, tasas } = opts;
  const { iva, iva_directo, derechos_mercado, impuesto_cheque, arancel_minimo } =
    tasas.costos;

  const esFce = instrumento === "fce";
  // La FCE no tributa IVA en aranceles ni en derechos.
  const ivaAplicable = esFce ? 0 : modalidad === "comitente" ? iva : iva_directo;

  const interes = monto - monto / (1 + (tnaInteres / 100) * (dias / DIAS_ANIO));
  const bruto = monto - interes;

  // Piso del arancel: si el cálculo da menos, la ALyC cobra el mínimo igual.
  // Sólo aplica si hay arancel; un tramo sin arancel no pasa a cobrarlo.
  const arancelCalculado = monto * (arancelPct / 100) * (dias / DIAS_ANIO);
  const arancel =
    arancelPct > 0 ? Math.max(arancelCalculado, arancel_minimo) : 0;

  const costos: CostoSimulador[] = [
    {
      concepto: "Interés",
      monto: interes,
      detalle: `${pct(tnaInteres)} TNA por ${dias} días`,
    },
    {
      concepto: "Arancel",
      monto: arancel,
      detalle:
        arancel > arancelCalculado
          ? `mínimo de ${arancel_minimo.toLocaleString("es-AR")} (el ${pct(arancelPct)} anual daba menos)`
          : `${pct(arancelPct)} anual por ${dias} días`,
    },
    {
      concepto: "IVA sobre el arancel",
      monto: arancel * (ivaAplicable / 100),
      detalle: pct(ivaAplicable),
    },
  ];

  if (modalidad === "comitente") {
    // Los derechos se prorratean hasta los 90 días; por encima se cobran enteros.
    const proporcion = Math.min(dias / DIAS_DERECHOS, 1);
    const derechos = bruto * (derechos_mercado / 100) * proporcion;

    costos.push(
      {
        concepto: "Derechos de mercado",
        monto: derechos,
        detalle:
          dias < DIAS_DERECHOS
            ? `${pct(derechos_mercado)} prorrateado a ${DIAS_DERECHOS} días`
            : pct(derechos_mercado),
      },
      {
        concepto: "IVA sobre los derechos",
        monto: derechos * (ivaAplicable / 100),
        detalle: pct(ivaAplicable),
      }
    );

    if (!esFce && opts.condicionComprador === "ri") {
      costos.push({
        concepto: "Percepción de IVA",
        monto: interes * (iva / 100),
        detalle: `${pct(iva)} del interés — no se cobra si el comprador es monotributista o consumidor final`,
      });
    }
  } else if (opts.diasHabilesAlPago < DIAS_HABILES_IMPUESTO_CHEQUE) {
    costos.push({
      concepto: "Impuesto al cheque",
      monto: monto * (impuesto_cheque / 100),
      detalle: `${pct(impuesto_cheque)} del valor nominal, por vencer en menos de ${DIAS_HABILES_IMPUESTO_CHEQUE} días hábiles`,
    });
  }

  return {
    // El interés siempre se muestra; el resto sólo si tiene importe.
    costos: costos.filter((c, i) => i === 0 || c.monto > 0),
    incluyePercepcion:
      modalidad === "comitente" && !esFce && opts.condicionComprador === "ri",
  };
}

export function simularCheques(
  input: SimuladorChequesInput,
  tasas: Tasas,
  ahora: Date = hoy()
): SimuladorChequesOutput {
  const fechaPago = parseISODate(input.fecha_pago);

  // En la FCE se negocia la parte que el comprador aceptó, no el total de la
  // factura: es lo que figura como valor nominal en el boleto.
  const monto =
    input.instrumento === "fce" && input.monto_aceptado
      ? input.monto_aceptado
      : input.monto;

  // El descuento corre hasta la fecha estimada de acreditación del comprador
  // (confirmado por el cliente el 31/07/2026), y ese mismo plazo define el
  // tramo de tasa que se aplica.
  const fechaAcreditacion = fechaAcreditacionEstimada(fechaPago, input.instrumento);
  const desde = fechaDesde(ahora, input.instrumento);
  const dias = Math.max(1, diasCalendarioEntre(desde, fechaAcreditacion));

  const tramo = tramoParaOperacion(tasas, {
    modalidad: input.modalidad,
    instrumento: input.instrumento,
    dias,
  });
  const tnaInteres = tramo.tasa;
  const arancelPct = tramo.gastos;
  const tna = tnaInteres + arancelPct; // TNA total que paga el vendedor

  const listaTramos =
    input.modalidad === "comitente"
      ? input.instrumento === "fce"
        ? [tasas.cheques.comitenteFce]
        : tasas.cheques.comitente
      : tasas.cheques.directo;

  const { costos, incluyePercepcion } = calcularCostos({
    monto,
    dias,
    diasHabilesAlPago: diasHabilesEntre(ahora, fechaPago),
    tnaInteres,
    arancelPct,
    modalidad: input.modalidad,
    instrumento: input.instrumento,
    condicionComprador: input.condicion_comprador ?? "ri",
    tasas,
  });

  const descuento = costos.reduce((total, c) => total + c.monto, 0);
  const monto_a_recibir = monto - descuento;

  return {
    monto_negociado: round2(monto),
    monto_a_recibir: round2(monto_a_recibir),
    descuento_total: round2(descuento),
    costos: costos.map((c) => ({ ...c, monto: round2(c.monto) })),
    costo_total_pct: round2((descuento / monto) * 100),
    tna_aplicada: round2(tna),
    tna_interes: tnaInteres,
    arancel: arancelPct,
    incluye_percepcion: incluyePercepcion,
    tramo: describirTramo(tramo, listaTramos),
    modalidad: input.modalidad,
    dias_considerados: dias,
    fecha_acreditacion_estimada: toISODate(fechaAcreditacion),
    // Quien vende el cheque cobra el día de la operación; la acreditación
    // calculada arriba es la del comprador.
    fecha_acreditacion_vendedor: toISODate(ahora),
    disclaimer: DISCLAIMER_CHEQUES,
  };
}

export function simularPrestamo(
  input: SimuladorPrestamosInput,
  tasas: Tasas
): SimuladorPrestamosOutput {
  // La tasa depende del solicitante y del mercado, no del tipo de persona:
  // se cotiza el rango entre las dos tasas cargadas en la hoja.
  const tnaDesde = Math.min(tasas.prestamos_ph, tasas.prestamos_pj);
  const tnaHasta = Math.max(tasas.prestamos_ph, tasas.prestamos_pj);

  const escenario = (tna: number) => {
    const cuota = cuotaSistemaFrances(input.monto, tna / 100 / 12, input.plazo_meses);
    const total = cuota * input.plazo_meses;
    return { cuota, total, intereses: total - input.monto };
  };

  const desde = escenario(tnaDesde);
  const hasta = escenario(tnaHasta);

  return {
    cuota_mensual_desde: round2(desde.cuota),
    cuota_mensual_hasta: round2(hasta.cuota),
    total_a_pagar_desde: round2(desde.total),
    total_a_pagar_hasta: round2(hasta.total),
    total_intereses_desde: round2(desde.intereses),
    total_intereses_hasta: round2(hasta.intereses),
    tna_desde: tnaDesde,
    tna_hasta: tnaHasta,
    disclaimer: DISCLAIMER_PRESTAMOS,
  };
}

export function cuotaSistemaFrances(
  monto: number,
  tasaMensual: number,
  plazoMeses: number
): number {
  if (tasaMensual === 0) return monto / plazoMeses;
  const factor = Math.pow(1 + tasaMensual, plazoMeses);
  return (monto * (tasaMensual * factor)) / (factor - 1);
}

export type { TipoPersona };
