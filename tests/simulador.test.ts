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
  cheques: {
    directo: [
      { hastaDias: 45, tasa: 48, gastos: 2 },
      { hastaDias: null, tasa: 72, gastos: 3.5 },
    ],
    comitente: [
      { hastaDias: 30, tasa: 40, gastos: 2.5 },
      { hastaDias: 60, tasa: 43, gastos: 2.5 },
      { hastaDias: null, tasa: 45, gastos: 2.5 },
    ],
    comitenteFce: { hastaDias: null, tasa: 40, gastos: 2.5 },
  },
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
    // El vendedor cobra el día de la operación, no cuando se acredita el comprador.
    expect(r.fecha_acreditacion_vendedor).toBe("2026-01-05");
    expect(r.dias_considerados).toBe(9);
    // 1.000.000 * (48% + 2%) * 9/365
    expect(r.descuento_total).toBeCloseTo(12328.77, 2);
    expect(r.monto_a_recibir).toBeCloseTo(987671.23, 2);
    expect(r.tna_aplicada).toBe(50);
  });

  it("la tasa total desglosa interés + gastos", () => {
    const r = simularCheques(input, TASAS, ahora);
    expect(r.tna_interes).toBe(48);
    expect(r.arancel).toBe(2);
    expect(r.tna_aplicada).toBeCloseTo(r.tna_interes + r.arancel, 10);
    expect(r.tramo).toBe("hasta 45 días");
  });

  // El plazo que define el tramo es el mismo que se usa para el descuento:
  // días hasta la acreditación del comprador.
  it("salta al tramo largo cuando la acreditación pasa los 45 días", () => {
    const corto = simularCheques({ ...input, fecha_pago: "2026-02-10" }, TASAS, ahora);
    expect(corto.dias_considerados).toBeLessThanOrEqual(45);
    expect(corto.tna_aplicada).toBe(50);

    const largo = simularCheques({ ...input, fecha_pago: "2026-03-16" }, TASAS, ahora);
    expect(largo.dias_considerados).toBeGreaterThanOrEqual(46);
    expect(largo.tna_interes).toBe(72);
    expect(largo.arancel).toBe(3.5);
    expect(largo.tramo).toBe("46 días o más");
  });

  it("comitente cotiza más barato que directo en el mismo plazo", () => {
    const comitente = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "echeq" },
      TASAS,
      ahora
    );
    expect(comitente.tna_interes).toBe(40);
    expect(comitente.tna_aplicada).toBe(42.5);
    expect(comitente.descuento_total).toBeLessThan(
      simularCheques(input, TASAS, ahora).descuento_total
    );
  });

  it("la FCE en comitente usa la estimación única", () => {
    const r = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "fce", fecha_pago: "2026-06-15" },
      TASAS,
      ahora
    );
    expect(r.tna_interes).toBe(40);
    expect(r.arancel).toBe(2.5);
    expect(r.tramo).toBe("todos los plazos");
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
  it("cotiza el rango entre las dos tasas de la hoja", () => {
    const r = simularPrestamo({ monto: 1_000_000, plazo_meses: 12 }, TASAS);
    expect(r.tna_desde).toBe(72);
    expect(r.tna_hasta).toBe(82);
    expect(r.cuota_mensual_hasta).toBeGreaterThan(r.cuota_mensual_desde);
  });

  it("ordena el rango aunque las tasas estén invertidas en la hoja", () => {
    const r = simularPrestamo(
      { monto: 1_000_000, plazo_meses: 12 },
      { ...TASAS, prestamos_ph: 82, prestamos_pj: 72 }
    );
    expect(r.tna_desde).toBe(72);
    expect(r.tna_hasta).toBe(82);
  });

  it("el total a pagar es cuota por plazo en ambos extremos", () => {
    const r = simularPrestamo({ monto: 500_000, plazo_meses: 6 }, TASAS);
    expect(r.total_a_pagar_desde).toBeCloseTo(r.cuota_mensual_desde * 6, 1);
    expect(r.total_a_pagar_hasta).toBeCloseTo(r.cuota_mensual_hasta * 6, 1);
    expect(r.total_intereses_desde).toBeCloseTo(r.total_a_pagar_desde - 500_000, 1);
  });
});
