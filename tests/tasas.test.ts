import { describe, expect, it } from "vitest";
import { describirTramo, parseTasasRows, tramoParaOperacion } from "@/lib/tasas";
import type { Tasas } from "@/types";

const HEADER = ["servicio", "tasa", "actualizado_el"];

/** Hoja completa según la grilla que confirmó el cliente el 31/07/2026. */
const FILAS = [
  ["directo_hasta_45", "48", "2026-07-31"],
  ["gastos_directo_hasta_45", "2"],
  ["directo_desde_46", "72"],
  ["gastos_directo_desde_46", "3,5"],
  ["comitente_hasta_30", "40"],
  ["comitente_31_60", "43"],
  ["comitente_desde_61", "45"],
  ["comitente_fce", "40"],
  ["arancel_comitente", "2,5"],
  ["prestamos_ph", "72"],
  ["prestamos_pj", "82"],
];

describe("parseTasasRows", () => {
  it("arma los tramos de cada modalidad", () => {
    const t = parseTasasRows([HEADER, ...FILAS]);

    expect(t.cheques.directo).toEqual([
      { hastaDias: 45, tasa: 48, gastos: 2 },
      { hastaDias: null, tasa: 72, gastos: 3.5 },
    ]);
    expect(t.cheques.comitente).toEqual([
      { hastaDias: 30, tasa: 40, gastos: 2.5 },
      { hastaDias: 60, tasa: 43, gastos: 2.5 },
      { hastaDias: null, tasa: 45, gastos: 2.5 },
    ]);
    // La FCE cotiza 40% todo incluido: sin fila de gastos, van en 0.
    expect(t.cheques.comitenteFce).toEqual({ hastaDias: null, tasa: 40, gastos: 0 });
    expect(t.prestamos_ph).toBe(72);
    expect(t.prestamos_pj).toBe(82);
    expect(t.actualizado_el).toBe("2026-07-31");
  });

  it("funciona sin fila de header", () => {
    expect(parseTasasRows(FILAS).cheques.directo[0].tasa).toBe(48);
  });

  it("acepta decimales con coma", () => {
    expect(parseTasasRows(FILAS).cheques.directo[1].gastos).toBe(3.5);
  });

  it("avisa qué filas faltan en vez de cotizar con huecos", () => {
    const incompletas = FILAS.filter(([k]) => k !== "comitente_31_60");
    expect(() => parseTasasRows(incompletas)).toThrow(/comitente_31_60/);
  });

  // Protege contra el formato viejo en fracción (0.15) y errores de tipeo.
  it("ignora tasas fuera del rango plausible", () => {
    const conBasura = FILAS.map((f) =>
      f[0] === "directo_hasta_45" ? ["directo_hasta_45", "0.15"] : f
    );
    expect(() => parseTasasRows(conBasura)).toThrow(/directo_hasta_45/);
  });

  it("ignora gastos absurdos", () => {
    const conBasura = FILAS.map((f) =>
      f[0] === "arancel_comitente" ? ["arancel_comitente", "250"] : f
    );
    expect(() => parseTasasRows(conBasura)).toThrow(/arancel_comitente/);
  });

  it("falla con hoja vacía", () => {
    expect(() => parseTasasRows([])).toThrow(/vacía/);
  });

  // Los costos que se le cobran al vendedor son filas opcionales: si faltan se
  // usan los valores de la planilla de cotización en vez de romper la lectura.
  it("toma los costos por defecto si la hoja no los trae", () => {
    expect(parseTasasRows(FILAS).costos).toEqual({
      iva: 21,
      derechos_mercado: 0.06,
      impuesto_cheque: 1.2,
    });
  });

  it("lee los costos de la hoja cuando están cargados", () => {
    const t = parseTasasRows([
      ...FILAS,
      ["iva", "10,5"],
      ["derechos_mercado", "0,08"],
      ["impuesto_cheque", "0,6"],
    ]);
    expect(t.costos).toEqual({ iva: 10.5, derechos_mercado: 0.08, impuesto_cheque: 0.6 });
  });
});

describe("tramoParaOperacion", () => {
  const tasas: Tasas = parseTasasRows(FILAS);
  const buscar = (modalidad: "directo" | "comitente", instrumento: "cheque" | "echeq" | "fce", dias: number) =>
    tramoParaOperacion(tasas, { modalidad, instrumento, dias });

  it("directo: 48% hasta el día 45, 72% desde el 46", () => {
    expect(buscar("directo", "cheque", 1).tasa).toBe(48);
    expect(buscar("directo", "cheque", 45).tasa).toBe(48);
    expect(buscar("directo", "cheque", 46).tasa).toBe(72);
    expect(buscar("directo", "cheque", 400).tasa).toBe(72);
  });

  it("directo: los gastos acompañan al tramo", () => {
    expect(buscar("directo", "echeq", 45).gastos).toBe(2);
    expect(buscar("directo", "echeq", 46).gastos).toBe(3.5);
  });

  it("comitente: 40 / 43 / 45 según el plazo", () => {
    expect(buscar("comitente", "echeq", 30).tasa).toBe(40);
    expect(buscar("comitente", "echeq", 31).tasa).toBe(43);
    expect(buscar("comitente", "echeq", 60).tasa).toBe(43);
    expect(buscar("comitente", "echeq", 61).tasa).toBe(45);
  });

  // La FCE no tiene tramos: su tasa depende del pagador de la factura.
  it("comitente FCE: 40% sin importar el plazo", () => {
    expect(buscar("comitente", "fce", 10).tasa).toBe(40);
    expect(buscar("comitente", "fce", 200).tasa).toBe(40);
  });

  it("comitente FCE: sin gastos, ni siquiera el arancel de comitente", () => {
    expect(buscar("comitente", "fce", 10).gastos).toBe(0);
  });

  it("comitente FCE: si la hoja carga gastos propios, se respetan", () => {
    const conGastos = parseTasasRows([...FILAS, ["gastos_comitente_fce", "1,5"]]);
    expect(conGastos.cheques.comitenteFce.gastos).toBe(1.5);
  });
});

describe("describirTramo", () => {
  const tasas = parseTasasRows(FILAS);

  it("describe los tramos de directo", () => {
    const d = tasas.cheques.directo;
    expect(describirTramo(d[0], d)).toBe("hasta 45 días");
    expect(describirTramo(d[1], d)).toBe("46 días o más");
  });

  it("describe los tramos intermedios de comitente", () => {
    const c = tasas.cheques.comitente;
    expect(describirTramo(c[0], c)).toBe("hasta 30 días");
    expect(describirTramo(c[1], c)).toBe("de 31 a 60 días");
    expect(describirTramo(c[2], c)).toBe("61 días o más");
  });

  it("la FCE no tiene tramos", () => {
    const f = tasas.cheques.comitenteFce;
    expect(describirTramo(f, [f])).toBe("todos los plazos");
  });
});
