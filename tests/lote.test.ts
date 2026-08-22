import { describe, expect, it } from "vitest";
import { cotizarLote } from "@/lib/lote";
import { MAX_FILAS_LOTE, parseLote } from "@/lib/validations";
import { simularCheques } from "@/lib/simulador";
import { parseISODate } from "@/lib/fechas";
import type { LoteInput, Tasas } from "@/types";

// La planilla "compra CPD PESOS" cotiza toda la tanda con un solo tramo, el de
// hasta 30 días al 42% + 2,5%.
const TASAS: Tasas = {
  cheques: {
    directo: [
      { hastaDias: 45, tasa: 48, gastos: 2 },
      { hastaDias: null, tasa: 72, gastos: 3.5 },
    ],
    comitente: [{ hastaDias: null, tasa: 42, gastos: 2.5 }],
    comitenteFce: { hastaDias: null, tasa: 28, gastos: 12 },
  },
  costos: {
    iva: 21,
    iva_directo: 21,
    derechos_mercado: 0.06,
    derechos_comprador: 0.03,
    arancel_comprador: 0,
    ingresos_brutos: 9,
    impuesto_cheque: 1.2,
    arancel_minimo: 500,
  },
  prestamos_ph: 72,
  prestamos_pj: 82,
  actualizado_el: "test",
};

const d = parseISODate;
const AHORA = d("2026-08-06");

// La primera fila es la de la planilla verificada al peso en simulador.test.ts
// (cheque de $4.432.155 con vencimiento 27/08, cobro 31/08, 25 días).
const LOTE: LoteInput = {
  modalidad: "comitente",
  instrumento: "echeq",
  condicion_vendedor: "ri",
  filas: [
    { id: "a", monto: 4_432_155, fecha_pago: "2026-08-27", cuit_librador: "20123456786", banco: "Galicia" },
    { id: "b", monto: 2_000_000, fecha_pago: "2026-08-20", cuit_librador: "20123456786", banco: "Galicia" },
    { id: "c", monto: 1_500_000, fecha_pago: "2026-09-03", banco: "Santander", numero: "00012345" },
  ],
};

describe("cotizarLote", () => {
  it("cotiza cada fila igual que el simulador de a uno", () => {
    const lote = cotizarLote(LOTE, TASAS, AHORA);

    for (const fila of LOTE.filas) {
      const suelta = simularCheques(
        {
          monto: fila.monto,
          fecha_pago: fila.fecha_pago,
          modalidad: LOTE.modalidad,
          instrumento: LOTE.instrumento,
          condicion_vendedor: "ri",
        },
        TASAS,
        AHORA
      );
      const enLote = lote.filas.find((f) => f.id === fila.id);
      expect(enLote?.resultado).toEqual(suelta);
    }
  });

  it("mantiene la fila de la planilla al peso dentro del lote", () => {
    const fila = cotizarLote(LOTE, TASAS, AHORA).filas[0]!;
    expect(fila.resultado.dias_considerados).toBe(25);
    expect(fila.resultado.monto_a_recibir).toBeCloseTo(4_272_141.66, 1);
    expect(fila.resultado.comprador?.total_a_pagar).toBeCloseTo(4_308_654.32, 1);
  });

  it("los totales son la suma de las filas, como la fila TOTAL de la planilla", () => {
    const { filas, totales } = cotizarLote(LOTE, TASAS, AHORA);
    const suma = (f: (i: number) => number) =>
      filas.reduce((t, _, i) => t + f(i), 0);

    expect(totales.cantidad).toBe(3);
    expect(totales.nominal).toBeCloseTo(4_432_155 + 2_000_000 + 1_500_000, 2);
    expect(totales.a_recibir).toBeCloseTo(
      suma((i) => filas[i]!.resultado.monto_a_recibir),
      1
    );
    expect(totales.descuento).toBeCloseTo(
      suma((i) => filas[i]!.resultado.descuento_total),
      1
    );
    // Lo negociado menos lo que descuentan tiene que ser lo que se cobra.
    expect(totales.nominal - totales.descuento).toBeCloseTo(totales.a_recibir, 1);
    expect(totales.costo_total_pct).toBeCloseTo(
      (totales.descuento / totales.nominal) * 100,
      2
    );
  });

  it("suma lo que desembolsa el comprador en el mercado de capitales", () => {
    const { filas, totales } = cotizarLote(LOTE, TASAS, AHORA);
    expect(totales.a_pagar_comprador).toBeCloseTo(
      filas.reduce((t, f) => t + (f.resultado.comprador?.total_a_pagar ?? 0), 0),
      1
    );
    // El comprador siempre pone más de lo que cobra el vendedor: la diferencia
    // son los aranceles, derechos e impuestos de la operación.
    expect(totales.a_pagar_comprador!).toBeGreaterThan(totales.a_recibir);
  });

  it("fuera del mercado no informa total del comprador", () => {
    const totales = cotizarLote(
      { ...LOTE, modalidad: "directo", instrumento: "cheque" },
      TASAS,
      AHORA
    ).totales;
    expect(totales.a_pagar_comprador).toBeUndefined();
    expect(totales.cantidad).toBe(3);
  });

  // En la FCE se negocia el valor aceptado, no el total facturado: el lote
  // tiene que totalizar sobre lo que efectivamente se cotiza.
  it("en FCE totaliza sobre el valor aceptado", () => {
    const { totales } = cotizarLote(
      {
        modalidad: "comitente",
        instrumento: "fce",
        condicion_vendedor: "ri",
        filas: [
          { id: "a", monto: 1_000_000, monto_aceptado: 800_000, fecha_pago: "2026-09-10" },
          { id: "b", monto: 500_000, monto_aceptado: 400_000, fecha_pago: "2026-09-10" },
        ],
      },
      TASAS,
      AHORA
    );
    expect(totales.nominal).toBeCloseTo(1_200_000, 2);
  });

  it("un lote vacío no rompe el porcentaje", () => {
    const { totales } = cotizarLote({ ...LOTE, filas: [] }, TASAS, AHORA);
    expect(totales).toEqual({
      cantidad: 0,
      nominal: 0,
      a_recibir: 0,
      descuento: 0,
      costo_total_pct: 0,
    });
  });
});

// El lote valida por fila y devuelve la ruta del campo (`filas.0.fecha_pago`),
// para que la tabla resalte la fila que está mal y no un error suelto.
describe("parseLote", () => {
  const base = {
    modalidad: "directo",
    instrumento: "cheque",
    filas: [{ id: "a", monto: 100_000, fecha_pago: "2026-12-10" }],
  };

  it("acepta un lote mínimo, sin CUIT", () => {
    expect(parseLote(base).success).toBe(true);
  });

  it("rechaza la combinación imposible de instrumento y modalidad", () => {
    const r = parseLote({ ...base, modalidad: "comitente" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.field).toBe("modalidad");
  });

  it("señala la fila que no llega al mínimo de días hábiles", () => {
    const r = parseLote({
      modalidad: "comitente",
      instrumento: "echeq",
      filas: [
        { id: "a", monto: 100_000, fecha_pago: "2027-12-10" },
        { id: "b", monto: 100_000, fecha_pago: "2020-01-02" },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.field).toBe("filas.1.fecha_pago");
  });

  it("no deja descontar un cheque propio", () => {
    const r = parseLote({
      ...base,
      cuit_endosatario: "20123456786",
      filas: [{ id: "a", monto: 100_000, fecha_pago: "2026-12-10", cuit_librador: "20123456786" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.field).toBe("filas.0.cuit_librador");
  });

  it("exige el valor aceptado en cada fila de FCE", () => {
    const r = parseLote({
      modalidad: "comitente",
      instrumento: "fce",
      filas: [{ id: "a", monto: 100_000, fecha_pago: "2027-12-10" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.field).toBe("filas.0.monto_aceptado");
  });

  it("pone un techo a la cantidad de cheques por tanda", () => {
    const filas = Array.from({ length: MAX_FILAS_LOTE + 1 }, (_, i) => ({
      id: String(i),
      monto: 1000,
      fecha_pago: "2026-12-10",
    }));
    const r = parseLote({ ...base, filas });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.field).toBe("filas");
  });

  it("rechaza un lote sin filas", () => {
    expect(parseLote({ ...base, filas: [] }).success).toBe(false);
  });
});
