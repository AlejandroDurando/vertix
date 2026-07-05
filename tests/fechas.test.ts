import { describe, expect, it } from "vitest";
import {
  diasCalendarioEntre,
  diasHabilesEntre,
  esDiaHabil,
  esFeriado,
  esFinDeSemana,
  parseISODate,
  sumarDiasHabiles,
  toISODate,
} from "@/lib/fechas";

// Referencias: 2026-01-01 fue jueves; 2026-01-03/04 sábado y domingo;
// 2026-01-05 lunes. 2026-05-01 (feriado) fue viernes.

const d = parseISODate;

describe("parseISODate / toISODate", () => {
  it("hace roundtrip sin corrimientos por timezone", () => {
    expect(toISODate(d("2026-01-01"))).toBe("2026-01-01");
    expect(toISODate(d("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("días hábiles", () => {
  it("detecta fines de semana", () => {
    expect(esFinDeSemana(d("2026-01-03"))).toBe(true); // sábado
    expect(esFinDeSemana(d("2026-01-04"))).toBe(true); // domingo
    expect(esFinDeSemana(d("2026-01-05"))).toBe(false); // lunes
  });

  it("detecta feriados", () => {
    expect(esFeriado(d("2026-07-09"))).toBe(true); // Independencia
    expect(esFeriado(d("2026-07-08"))).toBe(false);
    expect(esDiaHabil(d("2026-05-01"))).toBe(false); // feriado en viernes
  });

  it("sumarDiasHabiles saltea fines de semana", () => {
    // Viernes 2026-01-02 + 2 hábiles → martes 2026-01-06
    expect(toISODate(sumarDiasHabiles(d("2026-01-02"), 2))).toBe("2026-01-06");
  });

  it("sumarDiasHabiles saltea feriados", () => {
    // Jueves 2026-04-30 + 1 hábil → lunes 2026-05-04 (1/5 feriado + finde)
    expect(toISODate(sumarDiasHabiles(d("2026-04-30"), 1))).toBe("2026-05-04");
  });

  it("diasHabilesEntre excluye el inicio e incluye el final", () => {
    expect(diasHabilesEntre(d("2026-01-02"), d("2026-01-06"))).toBe(2); // lun, mar
    expect(diasHabilesEntre(d("2026-01-06"), d("2026-01-02"))).toBe(0);
  });
});

describe("diasCalendarioEntre", () => {
  it("cuenta días calendario", () => {
    expect(diasCalendarioEntre(d("2026-01-01"), d("2026-01-31"))).toBe(30);
    expect(diasCalendarioEntre(d("2026-01-31"), d("2026-01-01"))).toBe(-30);
  });
});
