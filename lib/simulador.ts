import type {
  SimuladorChequesInput,
  SimuladorChequesOutput,
  SimuladorPrestamosInput,
  SimuladorPrestamosOutput,
  Tasas,
  TipoPersona,
} from "@/types";
import { getTasaForServicio } from "./tasas";

const DISCLAIMER_CHEQUES =
  "Cotización orientativa. La tasa final depende de evaluación crediticia y condiciones del mercado.";
const DISCLAIMER_PRESTAMOS =
  "Cotización orientativa. La tasa final depende de evaluación crediticia y puede ser negociada.";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function simularCheques(
  input: SimuladorChequesInput,
  tasas: Tasas
): SimuladorChequesOutput {
  const tasaDiaria = getTasaForServicio(tasas, "cheques");
  // Convención: tasa expresada como porcentaje (ej. 0.15 = 0.15% diario)
  const descuento = input.monto * (tasaDiaria / 100) * input.dias_vencimiento;
  const monto_a_recibir = input.monto - descuento;
  return {
    monto_a_recibir: round2(monto_a_recibir),
    descuento_total: round2(descuento),
    tasa_aplicada: tasaDiaria,
    disclaimer: DISCLAIMER_CHEQUES,
  };
}

export function simularPrestamo(
  input: SimuladorPrestamosInput,
  tasas: Tasas
): SimuladorPrestamosOutput {
  const tasaServicio = input.tipo_persona === "humana" ? "prestamos_ph" : "prestamos_pj";
  const tasaMensual = getTasaForServicio(tasas, tasaServicio);
  const cuota = cuotaSistemaFrances(input.monto, tasaMensual, input.plazo_meses);
  const total = cuota * input.plazo_meses;
  const intereses = total - input.monto;
  return {
    cuota_mensual: round2(cuota),
    total_a_pagar: round2(total),
    total_intereses: round2(intereses),
    tasa_aplicada: tasaMensual,
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
