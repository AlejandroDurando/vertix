import type {
  CondicionIva,
  CostoSimulador,
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
 * Un cheque se acredita 2 días hábiles después de su fecha de pago si ésta es
 * un día hábil, y 3 días hábiles después si cae en fin de semana o feriado.
 */
export function fechaAcreditacionEstimada(fechaPago: Date): Date {
  return sumarDiasHabiles(fechaPago, esDiaHabil(fechaPago) ? 2 : 3);
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
 * mercado con su IVA y la percepción de IVA sobre el interés. Fuera del
 * mercado no se cobra nada de eso, pero sí el impuesto al cheque cuando el
 * plazo es corto.
 */
function calcularCostos(opts: {
  monto: number;
  dias: number;
  diasHabilesAlPago: number;
  tnaInteres: number;
  arancelPct: number;
  modalidad: ModalidadCheque;
  condicionComprador: CondicionIva;
  tasas: Tasas;
}): { costos: CostoSimulador[]; incluyePercepcion: boolean } {
  const { monto, dias, tnaInteres, arancelPct, modalidad, tasas } = opts;
  const { iva, derechos_mercado, impuesto_cheque } = tasas.costos;

  const interes = monto - monto / (1 + (tnaInteres / 100) * (dias / DIAS_ANIO));
  const bruto = monto - interes;
  const arancel = monto * (arancelPct / 100) * (dias / DIAS_ANIO);

  const costos: CostoSimulador[] = [
    {
      concepto: "Interés",
      monto: interes,
      detalle: `${pct(tnaInteres)} TNA por ${dias} días`,
    },
    {
      concepto: "Arancel Vertix",
      monto: arancel,
      detalle: `${pct(arancelPct)} anual por ${dias} días`,
    },
  ];

  if (modalidad === "comitente") {
    // Los derechos se prorratean hasta los 90 días; por encima se cobran enteros.
    const proporcion = Math.min(dias / DIAS_DERECHOS, 1);
    const derechos = bruto * (derechos_mercado / 100) * proporcion;

    costos.push(
      { concepto: "IVA sobre el arancel", monto: arancel * (iva / 100), detalle: pct(iva) },
      {
        concepto: "Derechos de mercado",
        monto: derechos,
        detalle:
          dias < DIAS_DERECHOS
            ? `${pct(derechos_mercado)} prorrateado a ${DIAS_DERECHOS} días`
            : pct(derechos_mercado),
      },
      { concepto: "IVA sobre los derechos", monto: derechos * (iva / 100), detalle: pct(iva) }
    );

    if (opts.condicionComprador === "ri") {
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
    // El interés siempre se muestra; el resto sólo si tiene importe (la FCE,
    // por ejemplo, cotiza sin arancel).
    costos: costos.filter((c, i) => i === 0 || c.monto > 0),
    incluyePercepcion: modalidad === "comitente" && opts.condicionComprador === "ri",
  };
}

export function simularCheques(
  input: SimuladorChequesInput,
  tasas: Tasas,
  ahora: Date = hoy()
): SimuladorChequesOutput {
  const fechaPago = parseISODate(input.fecha_pago);

  // El descuento corre hasta la fecha estimada de acreditación del comprador
  // (confirmado por el cliente el 31/07/2026), y ese mismo plazo define el
  // tramo de tasa que se aplica.
  const fechaAcreditacion = fechaAcreditacionEstimada(fechaPago);
  const dias = Math.max(1, diasCalendarioEntre(ahora, fechaAcreditacion));

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
    monto: input.monto,
    dias,
    diasHabilesAlPago: diasHabilesEntre(ahora, fechaPago),
    tnaInteres,
    arancelPct,
    modalidad: input.modalidad,
    condicionComprador: input.condicion_comprador ?? "ri",
    tasas,
  });

  const descuento = costos.reduce((total, c) => total + c.monto, 0);
  const monto_a_recibir = input.monto - descuento;

  return {
    monto_a_recibir: round2(monto_a_recibir),
    descuento_total: round2(descuento),
    costos: costos.map((c) => ({ ...c, monto: round2(c.monto) })),
    costo_total_pct: round2((descuento / input.monto) * 100),
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
