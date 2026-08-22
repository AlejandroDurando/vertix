import { describe, expect, it } from "vitest";
import { resumirRevision, revisarFilas, type FilaRevisable } from "@/lib/revision-lote";
import { parseISODate } from "@/lib/fechas";

const AHORA = parseISODate("2026-08-21");

const fila = (extra: Partial<FilaRevisable> = {}): FilaRevisable => ({
  id: "a",
  monto: 1_000_000,
  fecha_pago: "2026-09-15",
  cuit_librador: "20123456786",
  banco: "Galicia",
  numero: "00012345",
  nominal_en_letras: null,
  ...extra,
});

const estado = (f: FilaRevisable[], i = 0) => revisarFilas(f, AHORA)[i]!;

describe("revisarFilas", () => {
  it("una fila completa y coherente no molesta a nadie", () => {
    expect(estado([fila()])).toEqual({ id: "a", estado: "ok", avisos: [] });
  });

  it("sin importe o sin vencimiento la fila queda incompleta", () => {
    expect(estado([fila({ monto: null })]).estado).toBe("incompleta");
    expect(estado([fila({ fecha_pago: null })]).estado).toBe("incompleta");
  });

  it("avisa si el vencimiento ya pasó", () => {
    const r = estado([fila({ fecha_pago: "2026-08-01" })]);
    expect(r.estado).toBe("revisar");
    expect(r.avisos[0]!.campo).toBe("fecha_pago");
  });

  // El error típico de lectura: 2027 por 2026, que multiplica el descuento.
  it("avisa si el vencimiento está demasiado lejos", () => {
    const r = estado([fila({ fecha_pago: "2028-09-15" })]);
    expect(r.estado).toBe("revisar");
    expect(r.avisos[0]!.mensaje).toContain("año");
  });

  it("atrapa un CUIT con un dígito mal leído", () => {
    const r = estado([fila({ cuit_librador: "20123456780" })]);
    expect(r.avisos.some((a) => a.campo === "cuit_librador")).toBe(true);
  });

  it("cruza el importe en números contra el escrito en letras", () => {
    const iguales = estado([fila({ monto: 1_000_000, nominal_en_letras: 1_000_000 })]);
    expect(iguales.estado).toBe("ok");

    const distintos = estado([fila({ monto: 1_000_000, nominal_en_letras: 100_000 })]);
    expect(distintos.estado).toBe("revisar");
    expect(distintos.avisos[0]!.campo).toBe("monto");
  });

  it("marca las dos filas cuando el mismo cheque entró dos veces", () => {
    const r = revisarFilas([fila({ id: "a" }), fila({ id: "b" })], AHORA);
    expect(r.every((x) => x.estado === "revisar")).toBe(true);
    expect(r[0]!.avisos[0]!.mensaje).toContain("dos veces");
  });

  it("sin número de cheque, el repetido se detecta por librador, importe y fecha", () => {
    const sinNumero = { numero: null, banco: null };
    const r = revisarFilas(
      [fila({ id: "a", ...sinNumero }), fila({ id: "b", ...sinNumero })],
      AHORA
    );
    expect(r.every((x) => x.estado === "revisar")).toBe(true);
  });

  it("dos cheques distintos del mismo librador no son un repetido", () => {
    const r = revisarFilas(
      [fila({ id: "a", numero: "1" }), fila({ id: "b", numero: "2", monto: 500_000 })],
      AHORA
    );
    expect(r.every((x) => x.estado === "ok")).toBe(true);
  });
});

describe("resumirRevision", () => {
  it("cuenta lo que frena y lo que sólo avisa", () => {
    const r = revisarFilas(
      [fila({ id: "a" }), fila({ id: "b", monto: null, numero: "9" }), fila({ id: "c", numero: "8", fecha_pago: "2026-08-01" })],
      AHORA
    );
    expect(resumirRevision(r)).toEqual({ incompletas: 1, aRevisar: 1 });
  });
});
