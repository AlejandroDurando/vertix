import { describe, expect, it } from "vitest";
import { nombreArchivoNota, notaEpymeDocx, type NotaEpymeInput } from "@/lib/nota-epyme";

const base: NotaEpymeInput = {
  alyc: "adcap",
  esPersonaJuridica: true,
  razonSocial: "Acme S.R.L.",
  caracterDomicilio: "Av. Corrientes 1234, CABA",
  adminNombre: "Juan Pérez",
  adminEmail: "alternativo@acme.com",
  adminDni: "23456789",
  adminCuit: "27876543219",
  adminTelefono: "1133445566",
  adminDomicilioLegal: "Av. Corrientes 1234, CABA",
  adminCargo: "Socio gerente",
  firmante: "Acme S.R.L.",
  firmanteCuit: "30987654321",
  firmanteCargo: "Socio gerente",
};

describe("notaEpymeDocx", () => {
  it("genera un .docx válido", async () => {
    const buf = await notaEpymeDocx(base);
    // Un .docx es un ZIP: empieza con la firma PK.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("no falla con campos vacíos (quedan como XXXX a completar)", async () => {
    const vacio: NotaEpymeInput = {
      ...base,
      razonSocial: "",
      adminNombre: "",
      firmanteCargo: "",
    };
    await expect(notaEpymeDocx(vacio)).resolves.toBeInstanceOf(Buffer);
  });
});

describe("nombreArchivoNota", () => {
  it("usa la razón social en persona jurídica", () => {
    expect(nombreArchivoNota(base)).toBe("nota-adhesion-epyme-acme-s-r-l.docx");
  });

  it("usa el nombre del titular en persona física", () => {
    expect(
      nombreArchivoNota({ ...base, esPersonaJuridica: false, firmante: "Pérez, Ana" })
    ).toBe("nota-adhesion-epyme-perez-ana.docx");
  });

  it("nunca queda sin nombre", () => {
    expect(
      nombreArchivoNota({ ...base, esPersonaJuridica: false, firmante: "///" })
    ).toBe("nota-adhesion-epyme-vertix.docx");
  });
});
