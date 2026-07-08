import { describe, expect, it } from "vitest";
import {
  cuotaSistemaFrances,
  fechaAcreditacionEstimada,
  simularCheques,
  simularPrestamo,
} from "@/lib/simulador";
import { parseISODate, toISODate } from "@/lib/fechas";
import type { Tasas } from "@/types";

const TASAS: Tasas = {
  cheques_directo: 48,
  cheques_comitente: 35,
  arancel_cheques: 2.5,
  prestamos_ph: 72,
  prestamos_pj: 82,
  actualizado_el: "test",
};

const d = parseISODate;

describe("fechaAcreditacionEstimada", () => {
  it("suma 2 días hábiles si la fecha de pago es hábil", () => {
    // Lunes 2026-01-12 → miércoles 2026-01-14
    expect(toISODate(fechaAcreditacionEstimada(d("2026-01-12")))).toBe("2026-01-14");
  });

  it("suma 3 días hábiles si la fecha de pago cae en fin de semana", () => {
    // Sábado 2026-01-17 → miércoles 2026-01-21
    expect(toISODate(fechaAcreditacionEstimada(d("2026-01-17")))).toBe("2026-01-21");
  });

  it("suma 3 días hábiles si la fecha de pago cae en feriado", () => {
    // Feriado jueves 2026-07-09 → martes 2026-07-14
    expect(toISODate(fechaAcreditacionEstimada(d("2026-07-09")))).toBe("2026-07-14");
  });
});

describe("simularCheques", () => {
  const input = {
    monto: 1_000_000,
    fecha_pago: "2026-01-12", // lunes
    modalidad: "directo" as const,
    instrumento: "cheque" as const,
  };
  const ahora = d("2026-01-05"); // lunes

  it("descuenta hasta la fecha estimada de acreditación", () => {
    const r = simularCheques(input, TASAS, ahora);
    // Acreditación: 2026-01-14 → 9 días calendario desde el 05.
    expect(r.fecha_acreditacion_estimada).toBe("2026-01-14");
    expect(r.dias_considerados).toBe(9);
    // 1.000.000 * (48% + 2,5%) * 9/365
    expect(r.descuento_total).toBeCloseTo(12452.05, 2);
    expect(r.monto_a_recibir).toBeCloseTo(987547.95, 2);
    expect(r.tna_aplicada).toBe(50.5);
  });

  it("la tasa total desglosa interés + arancel", () => {
    const r = simularCheques(input, TASAS, ahora);
    expect(r.tna_interes).toBe(48);
    expect(r.arancel).toBe(2.5);
    expect(r.tna_aplicada).toBeCloseTo(r.tna_interes + r.arancel, 10);
  });

  it("usa la tasa comitente cuando corresponde (más el arancel)", () => {
    const r = simularCheques({ ...input, modalidad: "comitente" }, TASAS, ahora);
    expect(r.tna_interes).toBe(35);
    expect(r.tna_aplicada).toBe(37.5);
    expect(r.descuento_total).toBeLessThan(
      simularCheques(input, TASAS, ahora).descuento_total
    );
  });
});

describe("cuotaSistemaFrances", () => {
  it("con tasa 0 divide el capital en partes iguales", () => {
    expect(cuotaSistemaFrances(120_000, 0, 12)).toBe(10_000);
  });

  it("amortiza exactamente el capital en el plazo", () => {
    const monto = 1_200_000;
    const tasaMensual = 0.06; // TNA 72
    const plazo = 12;
    const cuota = cuotaSistemaFrances(monto, tasaMensual, plazo);

    let saldo = monto;
    for (let i = 0; i < plazo; i++) {
      saldo = saldo * (1 + tasaMensual) - cuota;
    }
    expect(saldo).toBeCloseTo(0, 6);
  });
});

describe("simularPrestamo", () => {
  it("aplica la tasa según el tipo de persona", () => {
    const base = { monto: 1_000_000, plazo_meses: 12 };
    const ph = simularPrestamo({ ...base, tipo_persona: "humana" }, TASAS);
    const pj = simularPrestamo({ ...base, tipo_persona: "empresa" }, TASAS);
    expect(ph.tna_aplicada).toBe(72);
    expect(pj.tna_aplicada).toBe(82);
    expect(pj.cuota_mensual).toBeGreaterThan(ph.cuota_mensual);
  });

  it("el total a pagar es cuota por plazo", () => {
    const r = simularPrestamo(
      { monto: 500_000, plazo_meses: 6, tipo_persona: "humana" },
      TASAS
    );
    expect(r.total_a_pagar).toBeCloseTo(r.cuota_mensual * 6, 1);
    expect(r.total_intereses).toBeCloseTo(r.total_a_pagar - 500_000, 1);
  });
});
