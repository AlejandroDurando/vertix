import { describe, expect, it } from "vitest";
import {
  MIN_DIAS_HABILES,
  precalificacionSchema,
  simuladorChequesSchema,
} from "@/lib/validations";
import { hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";

// El piso de 5 días hábiles lo exige el mercado de capitales: rige sólo con
// cuenta comitente. Simulador y precalificación piden la modalidad, así que
// los dos aplican la misma regla.
const manana = toISODate(sumarDiasHabiles(hoy(), 1));
const lejos = toISODate(sumarDiasHabiles(hoy(), MIN_DIAS_HABILES + 5));

const CUIT_A = "20123456786";
const CUIT_B = "30987654321";

const simulador = (over: Record<string, unknown>) =>
  simuladorChequesSchema.safeParse({
    tipo: "cheques",
    monto: 100000,
    fecha_pago: lejos,
    modalidad: "directo",
    instrumento: "cheque",
    cuit_librador: CUIT_A,
    cuit_endosatario: CUIT_B,
    ...over,
  });

const precalificacion = (over: Record<string, unknown>) =>
  precalificacionSchema.safeParse({
    servicio: "cheques",
    nombre: "Juan Pérez",
    email: "juan@example.com",
    telefono: "1122334455",
    empresa: "Titular",
    instrumento: "cheque",
    modalidad: "directo",
    monto_cheque: 100000,
    fecha_pago: lejos,
    banco_emisor: "Galicia",
    cuit_librador: CUIT_A,
    cuit_endosatario: CUIT_B,
    ...over,
  });

describe("simulador de cheques — mínimo de días hábiles por modalidad", () => {
  // La cuenta comitente sólo admite echeq/FCE, así que se combina con echeq.
  it("bloquea con cuenta comitente si faltan menos de 5 días hábiles", () => {
    const res = simulador({
      instrumento: "echeq",
      modalidad: "comitente",
      fecha_pago: manana,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["fecha_pago"]);
    }
  });

  it("permite directo con Vertix aunque falten menos de 5 días hábiles", () => {
    expect(simulador({ modalidad: "directo", fecha_pago: manana }).success).toBe(true);
  });

  it("permite echeq directo con Vertix con vencimiento corto", () => {
    expect(
      simulador({ instrumento: "echeq", modalidad: "directo", fecha_pago: manana })
        .success
    ).toBe(true);
  });

  it("permite cuenta comitente con vencimiento suficiente", () => {
    expect(simulador({ instrumento: "echeq", modalidad: "comitente" }).success).toBe(
      true
    );
  });
});

describe("simulador de cheques — instrumento y modalidad", () => {
  // En el mercado de capitales sólo se negocian echeq y FCE.
  it("rechaza el cheque físico con cuenta comitente", () => {
    const res = simulador({ instrumento: "cheque", modalidad: "comitente" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["modalidad"]);
    }
  });

  it("acepta el cheque físico directo con Vertix", () => {
    expect(simulador({ instrumento: "cheque", modalidad: "directo" }).success).toBe(true);
  });

  it("acepta echeq y FCE con cuenta comitente", () => {
    expect(simulador({ instrumento: "echeq", modalidad: "comitente" }).success).toBe(true);
    expect(simulador({ instrumento: "fce", modalidad: "comitente" }).success).toBe(true);
  });

  // La FCE es lo inverso al cheque físico: sólo se negocia en el mercado.
  it("rechaza la FCE directo con Vertix", () => {
    const res = simulador({ instrumento: "fce", modalidad: "directo" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["modalidad"]);
    }
  });

  it("acepta el echeq por las dos vías", () => {
    expect(simulador({ instrumento: "echeq", modalidad: "directo" }).success).toBe(true);
    expect(simulador({ instrumento: "echeq", modalidad: "comitente" }).success).toBe(true);
  });
});

// Desde que la precalificación pide la modalidad (06/08/2026) aplica las
// mismas reglas que el simulador.
describe("precalificación de cheques — modalidad", () => {
  it("bloquea con cuenta comitente si faltan menos de 5 días hábiles", () => {
    const res = precalificacion({
      instrumento: "echeq",
      modalidad: "comitente",
      fecha_pago: manana,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["fecha_pago"]);
    }
  });

  it("permite sin cuenta comitente aunque falten menos de 5 días hábiles", () => {
    expect(
      precalificacion({ instrumento: "echeq", modalidad: "directo", fecha_pago: manana })
        .success
    ).toBe(true);
    expect(
      precalificacion({ instrumento: "cheque", modalidad: "directo", fecha_pago: manana })
        .success
    ).toBe(true);
  });

  it("rechaza el cheque físico con cuenta comitente", () => {
    const res = precalificacion({ instrumento: "cheque", modalidad: "comitente" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["modalidad"]);
    }
  });

  it("rechaza la FCE sin cuenta comitente", () => {
    const res = precalificacion({ instrumento: "fce", modalidad: "directo" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["modalidad"]);
    }
  });

  it("exige el instrumento y la modalidad", () => {
    expect(precalificacion({ instrumento: undefined }).success).toBe(false);
    expect(precalificacion({ modalidad: undefined }).success).toBe(false);
  });
});

describe("cheques propios", () => {
  it("rechaza librador y endosatario iguales en el simulador", () => {
    expect(simulador({ cuit_endosatario: CUIT_A }).success).toBe(false);
  });

  it("rechaza librador y endosatario iguales en la precalificación", () => {
    expect(precalificacion({ cuit_endosatario: CUIT_A }).success).toBe(false);
  });
});
