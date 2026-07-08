import type {
  SimuladorChequesInput,
  SimuladorChequesOutput,
  SimuladorPrestamosInput,
  SimuladorPrestamosOutput,
  Tasas,
  TipoPersona,
} from "@/types";
import { getTasaForServicio } from "./tasas";
import {
  diasCalendarioEntre,
  esDiaHabil,
  hoy,
  parseISODate,
  sumarDiasHabiles,
  toISODate,
} from "./fechas";

// Las tasas de la hoja se interpretan como TNA (Tasa Nominal Anual) en %.
const DIAS_ANIO = 365;

const DISCLAIMER_CHEQUES =
  "Cotización orientativa, calculada hasta la fecha estimada de acreditación (2 o 3 días hábiles posteriores a la fecha de pago), por lo que el resultado puede diferir. La tasa incluye el arancel de la empresa, pero no contempla otros derechos de mercado ni impuestos que se le cobran al vendedor del cheque. El otorgamiento depende de aprobación crediticia y no incluye gastos de sellados, certificación de firmas, etc. La tasa puede variar.";

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

export function simularCheques(
  input: SimuladorChequesInput,
  tasas: Tasas,
  ahora: Date = hoy()
): SimuladorChequesOutput {
  const servicio =
    input.modalidad === "comitente" ? "cheques_comitente" : "cheques_directo";
  const tnaInteres = getTasaForServicio(tasas, servicio); // % anual (variable)
  const arancel = tasas.arancel_cheques; // % anual (arancel empresa, fijo)
  const tna = tnaInteres + arancel; // TNA total que paga el vendedor
  const fechaPago = parseISODate(input.fecha_pago);

  // El descuento corre hasta la fecha estimada de acreditación (no hasta la
  // fecha de pago), que es cuando el vendedor recibe efectivamente los fondos.
  const fechaAcreditacion = fechaAcreditacionEstimada(fechaPago);
  const dias = Math.max(1, diasCalendarioEntre(ahora, fechaAcreditacion));

  const descuento = input.monto * (tna / 100) * (dias / DIAS_ANIO);
  const monto_a_recibir = input.monto - descuento;

  return {
    monto_a_recibir: round2(monto_a_recibir),
    descuento_total: round2(descuento),
    tna_aplicada: round2(tna),
    tna_interes: tnaInteres,
    arancel,
    modalidad: input.modalidad,
    dias_considerados: dias,
    fecha_acreditacion_estimada: toISODate(fechaAcreditacion),
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
