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
  "Cotización orientativa. No incluye impuestos ni otros gastos propios del crédito a otorgar (sellados, certificación de firmas, etc.). El otorgamiento depende de aprobación crediticia y la tasa final puede variar.";

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
  const tasaServicio = input.tipo_persona === "humana" ? "prestamos_ph" : "prestamos_pj";
  const tna = getTasaForServicio(tasas, tasaServicio); // % anual
  const tasaMensual = tna / 100 / 12; // fracción mensual

  const cuota = cuotaSistemaFrances(input.monto, tasaMensual, input.plazo_meses);
  const total = cuota * input.plazo_meses;
  const intereses = total - input.monto;

  return {
    cuota_mensual: round2(cuota),
    total_a_pagar: round2(total),
    total_intereses: round2(intereses),
    tna_aplicada: tna,
    tasa_mensual: round2(tasaMensual * 100),
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
