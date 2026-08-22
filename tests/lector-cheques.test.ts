import { describe, expect, it } from "vitest";
import {
  buscarCuit,
  interpretarTexto,
  leerCheques,
  leerCsv,
  leerXlsx,
  parsearFecha,
  normalizarLeido,
  parsearImporte,
} from "@/lib/lector-cheques";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("parsearImporte", () => {
  it("lee el formato de acá", () => {
    expect(parsearImporte("1.234.567,89")).toBe(1_234_567.89);
    expect(parsearImporte("$ 4.432.155,00")).toBe(4_432_155);
  });

  it("lee también el formato con punto decimal", () => {
    expect(parsearImporte("1,234,567.89")).toBe(1_234_567.89);
  });

  it("no confunde los miles con centavos", () => {
    expect(parsearImporte("1.500")).toBe(1500);
    expect(parsearImporte("1,500")).toBe(1500);
  });

  it("devuelve null si no hay números", () => {
    expect(parsearImporte("s/d")).toBeNull();
  });
});

describe("parsearFecha", () => {
  it("lee dd/mm/aaaa y aaaa-mm-dd", () => {
    expect(parsearFecha("27/08/2026")).toBe("2026-08-27");
    expect(parsearFecha("2026-08-27")).toBe("2026-08-27");
    expect(parsearFecha("27-8-26")).toBe("2026-08-27");
  });

  it("rechaza un día que no existe", () => {
    expect(parsearFecha("31/02/2026")).toBeNull();
  });
});

describe("buscarCuit", () => {
  it("lo encuentra con y sin guiones y valida el dígito", () => {
    expect(buscarCuit("CUIT 20-12345678-6")).toBe("20123456786");
    expect(buscarCuit("20123456786")).toBe("20123456786");
    expect(buscarCuit("20123456780")).toBeNull();
  });
});

describe("leerCsv", () => {
  it("mapea las columnas del export del banco", () => {
    const csv = [
      "Nro. Cheque;Banco;CUIT Librador;Vencimiento;Importe",
      "00012345;Galicia;20-12345678-6;27/08/2026;4.432.155,00",
      "00012346;Santander;20123456786;03/09/2026;2.000.000,00",
    ].join("\n");

    expect(leerCsv(csv, "listado.csv")).toEqual([
      {
        nominal: 4_432_155,
        fecha_pago: "2026-08-27",
        cuit_librador: "20123456786",
        banco: "Galicia",
        numero: "00012345",
        nominal_en_letras: null,
        origen: "listado.csv",
      },
      {
        nominal: 2_000_000,
        fecha_pago: "2026-09-03",
        cuit_librador: "20123456786",
        banco: "Santander",
        numero: "00012346",
        nominal_en_letras: null,
        origen: "listado.csv",
      },
    ]);
  });

  it("saltea los títulos que el banco pone arriba de la tabla", () => {
    const csv = [
      "Banco Ejemplo S.A.",
      "Listado de echeq al 21/08/2026",
      "",
      "Vencimiento,Importe",
      "27/08/2026,\"4.432.155,00\"",
    ].join("\n");
    const filas = leerCsv(csv, "x.csv");
    expect(filas).toHaveLength(1);
    expect(filas[0]!.nominal).toBe(4_432_155);
  });

  it("descarta las filas sin importe ni fecha", () => {
    const csv = ["Vencimiento;Importe", "27/08/2026;1.000.000,00", ";", "TOTAL;"].join("\n");
    expect(leerCsv(csv, "x.csv")).toHaveLength(1);
  });
});

describe("interpretarTexto", () => {
  it("toma una línea con fecha e importe como un cheque", () => {
    const texto = [
      "Listado de valores",
      "00012345  Galicia  20-12345678-6  27/08/2026  4.432.155,00",
      "00012346  Santander  20-12345678-6  03/09/2026  2.000.000,00",
    ].join("\n");
    const filas = interpretarTexto(texto, "listado.pdf");

    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({
      nominal: 4_432_155,
      fecha_pago: "2026-08-27",
      cuit_librador: "20123456786",
      numero: "00012345",
    });
  });

  it("con dos fechas en la línea se queda con el vencimiento", () => {
    const filas = interpretarTexto("Emisión 06/08/2026 Vto 27/08/2026 $ 1.000.000,00", "a.pdf");
    expect(filas[0]!.fecha_pago).toBe("2026-08-27");
  });

  it("no lee el año ni el CUIT como si fueran plata", () => {
    const filas = interpretarTexto("20-12345678-6  27/08/2026  4.432.155,00", "a.pdf");
    expect(filas[0]!.nominal).toBe(4_432_155);
  });

  it("un PDF de un cheque suelto se lee como un cheque", () => {
    const texto = [
      "BANCO DE LA NACION ARGENTINA",
      "Páguese a la orden de",
      "Pesos un millón",
      "$ 1.000.000,00",
      "Fecha de pago 27/08/2026",
    ].join("\n");
    const filas = interpretarTexto(texto, "cheque.pdf");
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ nominal: 1_000_000, fecha_pago: "2026-08-27" });
  });

  it("no inventa cheques si no hay nada que leer", () => {
    expect(interpretarTexto("Estimado cliente: adjuntamos su resumen.", "a.pdf")).toEqual([]);
  });
});

describe("leerCheques", () => {
  it("elige el camino de la planilla por la extensión", async () => {
    const csv = "Vencimiento;Importe\n27/08/2026;1.000.000,00";
    const r = await leerCheques({ nombre: "a.csv", tipo: "text/csv", datos: bytes(csv) });
    expect(r.via).toBe("planilla");
    expect(r.cheques).toHaveLength(1);
  });

  it("manda al modelo lo que no puede leer solo", async () => {
    const r = await leerCheques({
      nombre: "foto.jpg",
      tipo: "image/jpeg",
      datos: new Uint8Array([1, 2, 3]),
    });
    expect(r.via).toBe("modelo");
    expect(r.cheques).toEqual([]);
  });
});

// El .xlsx real del cliente es la prueba de que el camino de Excel sirve para
// algo más que un archivo armado a medida.
describe("leerXlsx", () => {
  it("lee una planilla de verdad sin romperse", async () => {
    const { readFile } = await import("node:fs/promises");
    const ruta = "Vertix S.A. - Prendas - Cuadro Cálculo Cuota Ramirez.xlsx";
    let datos: Uint8Array;
    try {
      datos = new Uint8Array(await readFile(ruta));
    } catch {
      return; // el archivo es del cliente y no está versionado
    }
    // No tiene columnas de cheques: lo que importa es que no explote.
    await expect(leerXlsx(datos, ruta)).resolves.toBeInstanceOf(Array);
  });
});

// Lo que devuelve el modelo no se toma como viene: pasa por los mismos parseos
// que el resto, así una alucinación queda en null y no en la tabla.
describe("normalizarLeido", () => {
  it("normaliza fecha, CUIT y número", () => {
    expect(
      normalizarLeido(
        {
          nominal: 4432155,
          fecha_pago: "27/08/2026",
          cuit_librador: "20-12345678-6",
          banco: "Galicia",
          numero: "Nº 00012345",
          nominal_en_letras: 4432155,
        },
        "foto.jpg"
      )
    ).toEqual({
      nominal: 4_432_155,
      fecha_pago: "2026-08-27",
      cuit_librador: "20123456786",
      banco: "Galicia",
      numero: "00012345",
      nominal_en_letras: 4_432_155,
      origen: "foto.jpg",
    });
  });

  it("descarta un CUIT que no cierra por dígito verificador", () => {
    const c = normalizarLeido(
      { nominal: 1000, fecha_pago: "2026-08-27", cuit_librador: "20123456780" },
      "a.jpg"
    );
    expect(c!.cuit_librador).toBeNull();
  });

  it("acepta el importe como texto", () => {
    const c = normalizarLeido({ nominal: "$ 1.234.567,89", fecha_pago: "2026-08-27" }, "a.jpg");
    expect(c!.nominal).toBe(1_234_567.89);
  });

  it("descarta la fila que no trae ni importe ni fecha", () => {
    expect(normalizarLeido({ banco: "Galicia" }, "a.jpg")).toBeNull();
  });

  it("deja en null lo que el modelo no pudo leer", () => {
    const c = normalizarLeido({ nominal: 1000, fecha_pago: null, cuit_librador: null }, "a.jpg");
    expect(c).toMatchObject({ fecha_pago: null, cuit_librador: null, banco: null });
  });
});
