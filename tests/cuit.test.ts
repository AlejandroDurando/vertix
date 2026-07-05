import { describe, expect, it } from "vitest";
import { esCuitValido, formatearCuit, normalizarCuit } from "@/lib/cuit";

describe("normalizarCuit", () => {
  it("deja sólo dígitos", () => {
    expect(normalizarCuit("20-12345678-6")).toBe("20123456786");
    expect(normalizarCuit(" 20 123 456 786 ")).toBe("20123456786");
  });
});

describe("esCuitValido", () => {
  // 20-12345678-6: suma = 2*5+0*4+1*3+2*2+3*7+4*6+5*5+6*4+7*3+8*2 = 148,
  // 148 % 11 = 5, verificador = 11 - 5 = 6.
  it("acepta un CUIT con dígito verificador correcto", () => {
    expect(esCuitValido("20123456786")).toBe(true);
    expect(esCuitValido("20-12345678-6")).toBe(true);
  });

  it("rechaza dígito verificador incorrecto", () => {
    expect(esCuitValido("20123456785")).toBe(false);
    expect(esCuitValido("20123456780")).toBe(false);
  });

  it("rechaza longitudes inválidas", () => {
    expect(esCuitValido("")).toBe(false);
    expect(esCuitValido("2012345678")).toBe(false);
    expect(esCuitValido("201234567861")).toBe(false);
  });

  it("rechaza todos los dígitos iguales", () => {
    expect(esCuitValido("11111111111")).toBe(false);
    expect(esCuitValido("00000000000")).toBe(false);
  });
});

describe("formatearCuit", () => {
  it("formatea como XX-XXXXXXXX-X", () => {
    expect(formatearCuit("20123456786")).toBe("20-12345678-6");
  });

  it("devuelve el original si no tiene 11 dígitos", () => {
    expect(formatearCuit("123")).toBe("123");
  });
});
