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
  hoy,
  parseISODate,
  sumarDiasHabiles,
  toISODate,
} from "./fechas";

// Las tasas de la hoja se interpretan como TNA (Tasa Nominal Anual) en %.
const DIAS_ANIO = 365;

// Días hábiles que tarda en acreditarse un cheque luego de su fecha de pago.
const DIAS_ACREDITACION_HABILES = 2;

const DISCLAIMER_CHEQUES =
  "Cotización orientativa. La fecha de acreditación real suele ser 2 o 3 días hábiles posteriores a la fecha de pago, por lo que el resultado puede diferir. No contempla otros derechos de mercado, impuestos ni aranceles que se le cobran al vendedor del cheque. El otorgamiento depende de aprobación crediticia y no incluye gastos de sellados, certificación de firmas, etc. La tasa puede variar.";

const DISCLAIMER_PRESTAMOS =
  "Cotización orientativa. No incluye impuestos ni otros gastos propios del crédito a otorgar (sellados, certificación de firmas, etc.). El otorgamiento depende de aprobación crediticia y la tasa final puede variar.";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function simularCheques(
  input: SimuladorChequesInput,
  tasas: Tasas
): SimuladorChequesOutput {
  const servicio =
    input.modalidad === "comitente" ? "cheques_comitente" : "cheques_directo";
  const tna = getTasaForServicio(tasas, servicio); // % anual
  const fechaPago = parseISODate(input.fecha_pago);

  // Días entre hoy y la fecha de pago (calendario). El cálculo es estimado.
  const dias = Math.max(1, diasCalendarioEntre(hoy(), fechaPago));

  const descuento = input.monto * (tna / 100) * (dias / DIAS_ANIO);
  const monto_a_recibir = input.monto - descuento;

  const fechaAcreditacion = sumarDiasHabiles(fechaPago, DIAS_ACREDITACION_HABILES);

  return {
    monto_a_recibir: round2(monto_a_recibir),
    descuento_total: round2(descuento),
    tna_aplicada: tna,
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
