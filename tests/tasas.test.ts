import { describe, expect, it } from "vitest";
import { parseTasasRows } from "@/lib/tasas";

const HEADER = ["servicio", "tasa", "actualizado_el"];

describe("parseTasasRows", () => {
  it("parsea las cuatro tasas con header", () => {
    const t = parseTasasRows([
      HEADER,
      ["cheques_directo", "43", "2026-07-01"],
      ["cheques_comitente", "35"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.cheques_directo).toBe(43);
    expect(t.cheques_comitente).toBe(35);
    expect(t.prestamos_ph).toBe(72);
    expect(t.prestamos_pj).toBe(82);
    expect(t.actualizado_el).toBe("2026-07-01");
  });

  it("acepta decimales con coma", () => {
    const t = parseTasasRows([
      ["cheques_directo", "43,5"],
      ["cheques_comitente", "35"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.cheques_directo).toBe(43.5);
  });

  it('el alias "cheques" aplica a ambas modalidades', () => {
    const t = parseTasasRows([
      ["cheques", "40"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.cheques_directo).toBe(40);
    expect(t.cheques_comitente).toBe(40);
  });

  it("lee el arancel de cheques cuando está en la hoja", () => {
    const t = parseTasasRows([
      ["cheques_directo", "48"],
      ["cheques_comitente", "35"],
      ["arancel_cheques", "2,5"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.arancel_cheques).toBe(2.5);
  });

  it("usa el arancel por defecto (2,5) si no está en la hoja", () => {
    const t = parseTasasRows([
      ["cheques", "48"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.arancel_cheques).toBe(2.5);
  });

  it("ignora un arancel absurdo y usa el default", () => {
    const t = parseTasasRows([
      ["cheques", "48"],
      ["arancel_cheques", "250"],
      ["prestamos_ph", "72"],
      ["prestamos_pj", "82"],
    ]);
    expect(t.arancel_cheques).toBe(2.5);
  });

  it("ignora tasas fuera de rango (formato fracción viejo, ej. 0.15)", () => {
    // cheques=0.15 se descarta → faltan las tasas de cheques → error → fallback.
    expect(() =>
      parseTasasRows([
        ["cheques", "0.15"],
        ["prestamos_ph", "72"],
        ["prestamos_pj", "82"],
      ])
    ).toThrow(/no contiene todos los servicios/);
  });

  it("ignora tasas absurdamente altas", () => {
    expect(() =>
      parseTasasRows([
        ["cheques", "4300"],
        ["prestamos_ph", "72"],
        ["prestamos_pj", "82"],
      ])
    ).toThrow(/no contiene todos los servicios/);
  });

  it("falla con hoja vacía", () => {
    expect(() => parseTasasRows([])).toThrow(/vacía/);
  });
});
