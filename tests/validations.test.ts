import { describe, expect, it } from "vitest";
import {
  MIN_DIAS_HABILES,
  PLAZOS_MESES,
  PLAZO_MAX_MESES,
  PLAZO_OPCIONES,
  cumpleMinDiasHabiles,
  fechaConcertacion,
  fechaPagoMinima,
  precalificacionSchema,
  simuladorChequesSchema,
  valorAceptadoSugerido,
} from "@/lib/validations";
import { esDiaHabil, hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";

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

describe("plazo de préstamos — lista cerrada", () => {
  const prestamo = (plazo: unknown) =>
    precalificacionSchema.safeParse({
      servicio: "prestamos",
      nombre: "Juan Pérez",
      email: "juan@example.com",
      telefono: "1122334455",
      tipo_persona: "humana",
      tipo_prestamo: "prendario",
      cuit_solicitante: CUIT_A,
      monto_solicitado: 1_000_000,
      plazo_meses: plazo,
      tipo_ingreso: "relacion_dependencia",
    });

  it("acepta los cuatro plazos que se ofrecen", () => {
    for (const meses of PLAZOS_MESES) {
      expect(prestamo(meses).success).toBe(true);
    }
  });

  it("rechaza cualquier otro plazo", () => {
    // 10 y 36 quedaban dentro del viejo rango libre de 1 a 24 / 120 meses.
    expect(prestamo(10).success).toBe(false);
    expect(prestamo(36).success).toBe(false);
    expect(prestamo(0).success).toBe(false);
  });

  it("el desplegable ofrece exactamente esos plazos", () => {
    expect(PLAZO_OPCIONES.map((o) => o.value)).toEqual(["6", "12", "18", "24"]);
    expect(PLAZO_MAX_MESES).toBe(24);
  });
});

describe("mínimo de días hábiles — se cuenta el día de la operación", () => {
  const miercoles = new Date(2026, 7, 19); // miércoles 19/08/2026

  it("el vencimiento más cercano es el 5º día hábil contando hoy", () => {
    // Ejemplo del cliente: vendiendo el miércoles 19/08, el mínimo es el 25/08.
    expect(toISODate(fechaPagoMinima(miercoles))).toBe("2026-08-25");
    expect(cumpleMinDiasHabiles("2026-08-25", miercoles)).toBe(true);
    expect(cumpleMinDiasHabiles("2026-08-24", miercoles)).toBe(false);
  });

  it("saltea el feriado del medio", () => {
    // Martes 07/07 con el feriado del jueves 09: el mínimo cae el martes 14.
    expect(toISODate(fechaPagoMinima(new Date(2026, 6, 7)))).toBe("2026-07-14");
    // El cheque real de esa venta vencía el 15/07 y entraba con un día de sobra.
    expect(cumpleMinDiasHabiles("2026-07-15", new Date(2026, 6, 7))).toBe(true);
  });

  it("si el día de la operación no es hábil, los 5 salen de los días siguientes", () => {
    // Sábado 22/08 → lunes 24 es el 1º hábil, el 5º es el viernes 28.
    expect(toISODate(fechaPagoMinima(new Date(2026, 7, 22)))).toBe("2026-08-28");
  });
});

describe("fecha de concertación", () => {
  it('por defecto es hoy', () => {
    expect(toISODate(fechaConcertacion())).toBe(toISODate(hoy()));
    expect(toISODate(fechaConcertacion("hoy"))).toBe(toISODate(hoy()));
  });

  it('"mañana" es el próximo día hábil, no el día siguiente', () => {
    // Viernes 2026-01-16 → lunes 2026-01-19
    const viernes = new Date(2026, 0, 16);
    expect(toISODate(fechaConcertacion("manana", viernes))).toBe("2026-01-19");
    expect(esDiaHabil(fechaConcertacion("manana", viernes))).toBe(true);
  });

  // Con fecha fija: si se midiera contra el día real, un sábado los dos pisos
  // caerían en el mismo lunes y la diferencia que se quiere probar no existiría.
  it("corre el piso de días hábiles junto con la concertación", () => {
    const miercoles = new Date(2026, 7, 19);
    expect(toISODate(fechaPagoMinima(miercoles))).toBe("2026-08-25");
    expect(toISODate(fechaPagoMinima(fechaConcertacion("manana", miercoles)))).toBe(
      "2026-08-26"
    );
  });

  it("acepta el vencimiento más cercano que se puede tomar hoy", () => {
    const justo = toISODate(fechaPagoMinima(hoy()));
    expect(
      simulador({ instrumento: "echeq", modalidad: "comitente", fecha_pago: justo }).success
    ).toBe(true);
  });
});

describe("valor aceptado de la FCE", () => {
  it("sugiere el 80% del total, redondeado a centavos", () => {
    // Total del boleto 348.884 de AdCap → el aceptado que figura en el boleto.
    expect(valorAceptadoSugerido(7_053_717.99)).toBe(5_642_974.39);
    expect(valorAceptadoSugerido(1_000_000)).toBe(800_000);
  });
});

describe("precalificación de FCE — valor aceptado", () => {
  const fce = { instrumento: "fce", modalidad: "comitente" };

  it("exige el valor aceptado", () => {
    const res = precalificacion(fce);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["monto_aceptado"]);
    }
  });

  it("no lo deja superar el total de la factura", () => {
    const res = precalificacion({ ...fce, monto_aceptado: 100_001 });
    expect(res.success).toBe(false);
  });

  it("acepta el aceptado dentro del total", () => {
    expect(precalificacion({ ...fce, monto_aceptado: 80_000 }).success).toBe(true);
  });

  // El multipart manda "" y readUploads lo convierte en 0: es "no vino".
  it("trata el 0 y el vacío como ausente", () => {
    const res = precalificacion({ ...fce, monto_aceptado: 0 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["monto_aceptado"]);
    }
    expect(precalificacion({ monto_aceptado: "" }).success).toBe(true);
  });
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
    expect(
      simulador({ instrumento: "fce", modalidad: "comitente", monto_aceptado: 80000 })
        .success
    ).toBe(true);
  });

  // En la FCE se negocia lo que el comprador aceptó, no el total facturado.
  it("exige el valor aceptado en la FCE", () => {
    const res = simulador({ instrumento: "fce", modalidad: "comitente" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0].path).toEqual(["monto_aceptado"]);
    }
  });

  it("rechaza un valor aceptado mayor al total de la factura", () => {
    expect(
      simulador({
        instrumento: "fce",
        modalidad: "comitente",
        monto: 100000,
        monto_aceptado: 120000,
      }).success
    ).toBe(false);
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
