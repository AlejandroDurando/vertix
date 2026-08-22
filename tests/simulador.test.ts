import { describe, expect, it } from "vitest";
import {
  cuotaSistemaFrances,
  fechaAcreditacionEstimada,
  simularCheques,
  simularPrestamo,
  totalesSistemaFrances,
} from "@/lib/simulador";
import { parseISODate, toISODate } from "@/lib/fechas";
import type { Tasas } from "@/types";

const TASAS: Tasas = {
  cheques: {
    directo: [
      { hastaDias: 45, tasa: 48, gastos: 2 },
      { hastaDias: null, tasa: 72, gastos: 3.5 },
    ],
    comitente: [
      { hastaDias: 30, tasa: 40, gastos: 2.5 },
      { hastaDias: 60, tasa: 43, gastos: 2.5 },
      { hastaDias: null, tasa: 45, gastos: 2.5 },
    ],
    // El 40% de la FCE es 28 de tasa + 12 de arancel (boleto de AdCap).
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

describe("fechaAcreditacionEstimada", () => {
  it("suma 2 días hábiles si la fecha de pago es hábil", () => {
    // Lunes 2026-01-12 → miércoles 2026-01-14
    expect(toISODate(fechaAcreditacionEstimada(d("2026-01-12")))).toBe("2026-01-14");
  });

  // Fuera del mercado son 3 días corridos, corridos al siguiente hábil si caen
  // en fin de semana o feriado (regla del cliente, 14/08/2026).
  const directo = (iso: string) =>
    toISODate(fechaAcreditacionEstimada(d(iso), "cheque", "directo"));

  it("fuera del mercado suma 3 días corridos", () => {
    // Lunes 2026-01-12 → jueves 2026-01-15
    expect(directo("2026-01-12")).toBe("2026-01-15");
  });

  it("fuera del mercado corre al siguiente hábil si el +3 cae en feriado", () => {
    // Ejemplo del cliente: vence el viernes 14/08, el +3 cae en el feriado del
    // lunes 17 (San Martín) → cobra el martes 18.
    expect(directo("2026-08-14")).toBe("2026-08-18");
  });

  it("fuera del mercado corre al siguiente hábil si el +3 cae en fin de semana", () => {
    // Jueves 2026-01-15 → domingo 18 → lunes 2026-01-19
    expect(directo("2026-01-15")).toBe("2026-01-19");
  });

  it("suma 3 días hábiles si la fecha de pago cae en fin de semana", () => {
    // Sábado 2026-01-17 → miércoles 2026-01-21
    expect(toISODate(fechaAcreditacionEstimada(d("2026-01-17")))).toBe("2026-01-21");
  });

  it("suma 3 días hábiles si la fecha de pago cae en feriado", () => {
    // Feriado jueves 2026-07-09 → martes 2026-07-14
    expect(toISODate(fechaAcreditacionEstimada(d("2026-07-09")))).toBe("2026-07-14");
  });
});

describe("simularCheques", () => {
  const input = {
    monto: 1_000_000,
    fecha_pago: "2026-01-12", // lunes
    modalidad: "directo" as const,
    instrumento: "cheque" as const,
  };
  const ahora = d("2026-01-05"); // lunes

  /** Importe de un concepto del desglose, 0 si no aparece. */
  const costo = (r: { costos: { concepto: string; monto: number }[] }, concepto: string) =>
    r.costos.find((c) => c.concepto === concepto)?.monto ?? 0;

  it("descuenta hasta la fecha estimada de acreditación", () => {
    const r = simularCheques(input, TASAS, ahora);
    // Fuera del mercado se acredita a +3 corridos: 2026-01-15, 10 días desde el 05.
    expect(r.fecha_acreditacion_estimada).toBe("2026-01-15");
    // El vendedor cobra el día de la operación, no cuando se acredita el comprador.
    expect(r.fecha_acreditacion_vendedor).toBe("2026-01-05");
    expect(r.dias_considerados).toBe(10);
    // Fuera del mercado el arancel es fijo, así que no se suma a la tasa.
    expect(r.tna_aplicada).toBe(48);
  });

  // Fuera del mercado el interés es descuento simple con base 360 (4% mensual),
  // no el racional del mercado de capitales.
  it("el interés directo es descuento simple sobre meses de 30 días", () => {
    const r = simularCheques(input, TASAS, ahora);
    expect(costo(r, "Interés")).toBeCloseTo(1_000_000 * 0.48 * (10 / 360), 2);
  });

  it("los gastos bancarios son un porcentaje fijo del capital", () => {
    const r = simularCheques(input, TASAS, ahora);
    // 2% de 1.000.000, sin prorratear por los 9 días.
    expect(costo(r, "Gastos bancarios")).toBe(20_000);
    expect(r.tna_interes).toBe(48);
    expect(r.arancel).toBe(2);
    expect(r.tramo).toBe("hasta 45 días");
  });

  it("suma Ingresos Brutos e IVA sobre la base ampliada", () => {
    const r = simularCheques(input, TASAS, ahora);
    const interes = costo(r, "Interés");
    const gastos = costo(r, "Gastos bancarios");
    const iibb = costo(r, "Ingresos Brutos");
    expect(iibb).toBeCloseTo(interes * 0.09, 2);
    expect(costo(r, "IVA")).toBeCloseTo((interes + gastos + iibb) * 0.21, 2);
  });

  it("suma el impuesto al cheque si vence en menos de 10 días hábiles", () => {
    const r = simularCheques(input, TASAS, ahora);
    expect(costo(r, "Impuesto al cheque")).toBe(12_000);
    expect(r.descuento_total).toBeCloseTo(53_785.33, 2);
    expect(r.monto_a_recibir).toBeCloseTo(946_214.67, 2);
  });

  it("no cobra el impuesto al cheque cuando el plazo lo absorbe", () => {
    const r = simularCheques({ ...input, fecha_pago: "2026-02-10" }, TASAS, ahora);
    expect(costo(r, "Impuesto al cheque")).toBe(0);
  });

  it("directo no cobra derechos de mercado ni percepción", () => {
    const r = simularCheques(input, TASAS, ahora);
    expect(costo(r, "Derechos de mercado")).toBe(0);
    expect(costo(r, "Percepción de IVA")).toBe(0);
    expect(r.incluye_percepcion).toBe(false);
  });

  it("el IVA de directo se puede apagar desde la hoja", () => {
    const sinIva: Tasas = { ...TASAS, costos: { ...TASAS.costos, iva_directo: 0 } };
    const r = simularCheques(input, sinIva, ahora);
    expect(costo(r, "IVA")).toBe(0);
  });

  // Descuento racional, como la planilla del mercado: se despeja el valor
  // presente en vez de aplicar la tasa sobre el nominal.
  it("el interés en el mercado es el descuento racional", () => {
    const r = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "echeq" },
      TASAS,
      ahora
    );
    expect(costo(r, "Interés")).toBeCloseTo(
      1_000_000 - 1_000_000 / (1 + 0.4 * (9 / 365)),
      2
    );
  });

  // 1.000.000 × 2,5% × 2/365 = 137, por debajo del piso de 500 de la ALyC.
  it("aplica el mínimo de arancel en el mercado cuando el cálculo da menos", () => {
    const r = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "echeq", monto: 100_000 },
      TASAS,
      ahora
    );
    expect(costo(r, "Arancel")).toBe(500);
  });

  it("comitente desglosa arancel, IVA, derechos y percepción", () => {
    const r = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "echeq" },
      TASAS,
      ahora
    );
    const interes = costo(r, "Interés");
    const arancel = costo(r, "Arancel");
    const derechos = costo(r, "Derechos de mercado");

    expect(costo(r, "IVA sobre el arancel")).toBeCloseTo(arancel * 0.21, 2);
    expect(costo(r, "IVA sobre los derechos")).toBeCloseTo(derechos * 0.21, 2);
    // Los derechos se prorratean sobre 90 días y se calculan sobre el bruto.
    expect(derechos).toBeCloseTo((1_000_000 - interes) * 0.0006 * (9 / 90), 2);
    expect(costo(r, "Percepción de IVA")).toBeCloseTo(interes * 0.21, 2);
    expect(r.incluye_percepcion).toBe(true);
    expect(r.descuento_total).toBeCloseTo(12_635.47, 2);
  });

  it("el vendedor monotributista o consumidor final no paga la percepción", () => {
    const r = simularCheques(
      {
        ...input,
        modalidad: "comitente",
        instrumento: "echeq",
        condicion_vendedor: "mono_cf",
      },
      TASAS,
      ahora
    );
    expect(costo(r, "Percepción de IVA")).toBe(0);
    expect(r.incluye_percepcion).toBe(false);
    expect(r.descuento_total).toBeCloseTo(10_584.47, 2);
  });

  // El plazo que define el tramo es el mismo que se usa para el descuento:
  // días hasta la acreditación del comprador.
  it("salta al tramo largo cuando la acreditación pasa los 45 días", () => {
    const corto = simularCheques({ ...input, fecha_pago: "2026-02-10" }, TASAS, ahora);
    expect(corto.dias_considerados).toBeLessThanOrEqual(45);
    expect(corto.tna_interes).toBe(48);

    const largo = simularCheques({ ...input, fecha_pago: "2026-03-16" }, TASAS, ahora);
    expect(largo.dias_considerados).toBeGreaterThanOrEqual(46);
    expect(largo.tna_interes).toBe(72);
    expect(largo.arancel).toBe(3.5);
    expect(largo.tramo).toBe("46 días o más");
    // El 3,5% del tramo largo también es fijo sobre el capital, igual que el 2%
    // del corto: no se prorratea por plazo (confirmado el 14/08/2026).
    expect(costo(largo, "Gastos bancarios")).toBe(35_000);
  });

  it("comitente cotiza más barato que directo en el mismo plazo", () => {
    const comitente = simularCheques(
      { ...input, modalidad: "comitente", instrumento: "echeq" },
      TASAS,
      ahora
    );
    expect(comitente.tna_interes).toBe(40);
    expect(comitente.tna_aplicada).toBe(42.5);
    expect(comitente.descuento_total).toBeLessThan(
      simularCheques(input, TASAS, ahora).descuento_total
    );
  });

  // Fila 7 de la planilla "compra CPD PESOS": cheque de $4.432.155 vendido el
  // 6/8/2026, vencimiento 27/8, cobro 31/8 (25 días), tasa 42% y arancel 2,5%.
  it("reproduce la fila de la planilla de cotización real", () => {
    const tasasPlanilla: Tasas = {
      ...TASAS,
      cheques: {
        ...TASAS.cheques,
        comitente: [{ hastaDias: 30, tasa: 42, gastos: 2.5 }],
      },
    };
    const r = simularCheques(
      {
        monto: 4_432_155,
        fecha_pago: "2026-08-27",
        modalidad: "comitente",
        instrumento: "echeq",
      },
      tasasPlanilla,
      d("2026-08-06")
    );

    expect(r.fecha_acreditacion_estimada).toBe("2026-08-31");
    expect(r.dias_considerados).toBe(25);
    expect(costo(r, "Interés")).toBeCloseTo(123_935.09, 1);
    expect(costo(r, "Arancel")).toBeCloseTo(7_589.31, 1);
    expect(costo(r, "IVA sobre el arancel")).toBeCloseTo(1_593.75, 1);
    expect(costo(r, "Derechos de mercado")).toBeCloseTo(718.04, 1);
    expect(costo(r, "IVA sobre los derechos")).toBeCloseTo(150.79, 1);
    expect(costo(r, "Percepción de IVA")).toBeCloseTo(26_026.37, 1);
    expect(r.monto_a_recibir).toBeCloseTo(4_272_141.66, 1);
  });

  // Bloque COMPRADOR de la misma planilla: valor presente + derechos (0,03%,
  // la mitad que los del vendedor) + IVA. Total a pagar 4.308.654,32.
  it("reproduce lo que pone el comprador", () => {
    const tasasPlanilla: Tasas = {
      ...TASAS,
      cheques: {
        ...TASAS.cheques,
        comitente: [{ hastaDias: 30, tasa: 42, gastos: 2.5 }],
      },
    };
    const r = simularCheques(
      {
        monto: 4_432_155,
        fecha_pago: "2026-08-27",
        modalidad: "comitente",
        instrumento: "echeq",
      },
      tasasPlanilla,
      d("2026-08-06")
    );
    const linea = (concepto: string) =>
      r.comprador?.costos.find((c) => c.concepto === concepto)?.monto ?? 0;

    expect(linea("Valor presente del cheque")).toBeCloseTo(4_308_219.91, 1);
    expect(linea("Derechos de mercado")).toBeCloseTo(359.02, 1);
    expect(linea("IVA sobre los derechos")).toBeCloseTo(75.39, 1);
    expect(r.comprador?.total_a_pagar).toBeCloseTo(4_308_654.32, 1);
    // Lo que separa el desembolso del comprador de lo que cobra el vendedor.
    expect(r.comprador?.diferencia_con_vendedor).toBeCloseTo(36_512.66, 1);
  });

  it("fuera del mercado no hay bloque del comprador", () => {
    const r = simularCheques(
      { monto: 1_000_000, fecha_pago: "2026-03-16", modalidad: "directo", instrumento: "cheque" },
      TASAS,
      d("2026-01-05")
    );
    expect(r.comprador).toBeUndefined();
  });

  it("la FCE en comitente usa la estimación única", () => {
    const r = simularCheques(
      {
        ...input,
        modalidad: "comitente",
        instrumento: "fce",
        monto_aceptado: 800_000,
        fecha_pago: "2026-06-15",
      },
      TASAS,
      ahora
    );
    expect(r.tna_interes).toBe(28);
    expect(r.arancel).toBe(12);
    expect(r.tna_aplicada).toBe(40);
    expect(r.tramo).toBe("todos los plazos");
  });

  // En la FCE se descuenta la parte aceptada por el comprador, no el total.
  it("la FCE cotiza sobre el valor aceptado", () => {
    const r = simularCheques(
      {
        ...input,
        monto: 1_000_000,
        monto_aceptado: 800_000,
        modalidad: "comitente",
        instrumento: "fce",
        fecha_pago: "2026-06-15",
      },
      TASAS,
      ahora
    );
    expect(r.monto_negociado).toBe(800_000);
    expect(r.monto_a_recibir).toBeLessThan(800_000);
  });
});

/**
 * Planilla de descuento directo del cliente (12/08/2026): capital
 * $35.990.137,04 vendido el 08/06 con vencimiento el viernes 17/07, 42 días,
 * 4% mensual y 2% de gastos bancarios.
 *
 * Los 42 días salen de descontar desde el día de la venta hasta el lunes 20/07:
 * fuera del mercado la acreditación es a +3 días corridos, y si cae en fin de
 * semana o feriado se corre al siguiente hábil (regla del cliente, 14/08/2026).
 *
 * La pestaña "ejemplo cheque" de la hoja de tasas repite esta misma planilla.
 */
describe("simularCheques — planilla de descuento directo", () => {
  const r = simularCheques(
    {
      monto: 35_990_137.04,
      fecha_pago: "2026-07-17",
      modalidad: "directo",
      instrumento: "cheque",
    },
    TASAS,
    d("2026-06-08")
  );
  const costo = (concepto: string) =>
    r.costos.find((c) => c.concepto === concepto)?.monto ?? 0;

  it("cuenta los mismos 42 días", () => {
    expect(r.dias_considerados).toBe(42);
    expect(r.fecha_acreditacion_estimada).toBe("2026-07-20");
  });

  it("reproduce cada línea de la planilla", () => {
    expect(costo("Interés")).toBeCloseTo(2_015_447.67, 1);
    expect(costo("Gastos bancarios")).toBeCloseTo(719_802.74, 1);
    expect(costo("Ingresos Brutos")).toBeCloseTo(181_390.29, 1);
    expect(costo("IVA")).toBeCloseTo(612_494.55, 1);
    expect(r.descuento_total).toBeCloseTo(3_529_135.25, 1);
    expect(r.monto_a_recibir).toBeCloseTo(32_461_001.79, 1);
  });
});

/**
 * Boleto 348.884 de AdCap (07/08/2026), la referencia real de una FCE:
 * concertación 10/08, liquidación 11/08, vencimiento 14/09 (lunes), cobro
 * 15/09 → 35 días. Tasa 28% + arancel 12% anual, sin IVA ni percepción.
 */
describe("simularCheques — boleto de FCE de AdCap", () => {
  const TASAS_FCE: Tasas = {
    ...TASAS,
    cheques: {
      ...TASAS.cheques,
      comitenteFce: { hastaDias: null, tasa: 28, gastos: 12 },
    },
  };

  const r = simularCheques(
    {
      monto: 7_053_717.99, // total de la factura
      monto_aceptado: 5_642_974.39, // lo que aceptó el comprador
      fecha_pago: "2026-09-14",
      modalidad: "comitente",
      instrumento: "fce",
    },
    TASAS_FCE,
    d("2026-08-10")
  );
  const costo = (concepto: string) =>
    r.costos.find((c) => c.concepto === concepto)?.monto ?? 0;

  it("cuenta 35 días: liquidación a 24hs y cobro a +1 día hábil", () => {
    expect(r.fecha_acreditacion_estimada).toBe("2026-09-15");
    expect(r.dias_considerados).toBe(35);
  });

  it("reproduce cada línea del boleto", () => {
    expect(r.monto_negociado).toBe(5_642_974.39);
    expect(costo("Interés")).toBeCloseTo(147_548.42, 1);
    expect(costo("Arancel")).toBeCloseTo(64_932.86, 1);
    expect(costo("Derechos de mercado")).toBeCloseTo(1_282.27, 1);
    expect(r.monto_a_recibir).toBeCloseTo(5_429_210.84, 1);
  });

  it("no cobra IVA ni percepción", () => {
    expect(costo("IVA sobre el arancel")).toBe(0);
    expect(costo("IVA sobre los derechos")).toBe(0);
    expect(costo("Percepción de IVA")).toBe(0);
    expect(r.incluye_percepcion).toBe(false);
  });
});

describe("cuotaSistemaFrances", () => {
  it("con tasa 0 divide el capital en partes iguales", () => {
    expect(cuotaSistemaFrances(120_000, 0, 12)).toBe(10_000);
  });

  it("amortiza exactamente el capital en el plazo", () => {
    const monto = 1_200_000;
    const tasaMensual = 0.06; // TNA 72
    const plazo = 12;
    const cuota = cuotaSistemaFrances(monto, tasaMensual, plazo);

    let saldo = monto;
    for (let i = 0; i < plazo; i++) {
      saldo = saldo * (1 + tasaMensual) - cuota;
    }
    expect(saldo).toBeCloseTo(0, 6);
  });
});

/**
 * Prenda real de julio de 2026 ("Cuadro Cálculo Cuota Ramirez"): capital
 * $7.500.000 a 12 meses, TNA 82% (TEM 6,8333%), IVA 21% sobre los intereses.
 *
 * El cuadro de la izquierda de la planilla es sistema francés; el de la derecha
 * —lo que se cobra— reparte ese total en cuotas todas iguales.
 */
describe("simularPrestamo — planilla de la prenda Ramirez", () => {
  const TASAS_PRENDA: Tasas = { ...TASAS, prestamos_ph: 82, prestamos_pj: 82 };
  const r = simularPrestamo({ monto: 7_500_000, plazo_meses: 12 }, TASAS_PRENDA);

  it("reproduce los totales del cuadro francés", () => {
    expect(r.total_intereses_desde).toBeCloseTo(3_730_741.12, 1);
    expect(r.total_iva_desde).toBeCloseTo(783_455.64, 1);
    expect(r.total_a_pagar_desde).toBeCloseTo(12_014_196.76, 1);
  });

  it("cobra todas las cuotas iguales, no la cuota francesa", () => {
    expect(r.cuota_mensual_desde).toBeCloseTo(1_001_183.06, 1);
    // La cuota pura del sistema francés es otra cosa y no es lo que se paga.
    expect(totalesSistemaFrances(7_500_000, 0.82 / 12, 12, 0.21).cuotaPura).toBeCloseTo(
      935_895.09,
      1
    );
    expect(r.cuota_mensual_desde * 12).toBeCloseTo(r.total_a_pagar_desde, 1);
  });
});

describe("simularPrestamo", () => {
  it("cotiza el rango entre las dos tasas de la hoja", () => {
    const r = simularPrestamo({ monto: 1_000_000, plazo_meses: 12 }, TASAS);
    expect(r.tna_desde).toBe(72);
    expect(r.tna_hasta).toBe(82);
    expect(r.cuota_mensual_hasta).toBeGreaterThan(r.cuota_mensual_desde);
  });

  it("ordena el rango aunque las tasas estén invertidas en la hoja", () => {
    const r = simularPrestamo(
      { monto: 1_000_000, plazo_meses: 12 },
      { ...TASAS, prestamos_ph: 82, prestamos_pj: 72 }
    );
    expect(r.tna_desde).toBe(72);
    expect(r.tna_hasta).toBe(82);
  });

  it("el total a pagar es cuota por plazo en ambos extremos", () => {
    const r = simularPrestamo({ monto: 500_000, plazo_meses: 6 }, TASAS);
    expect(r.total_a_pagar_desde).toBeCloseTo(r.cuota_mensual_desde * 6, 1);
    expect(r.total_a_pagar_hasta).toBeCloseTo(r.cuota_mensual_hasta * 6, 1);
    // El total ahora es capital + intereses + IVA sobre los intereses.
    expect(r.total_intereses_desde + r.total_iva_desde).toBeCloseTo(
      r.total_a_pagar_desde - 500_000,
      1
    );
    expect(r.total_iva_desde).toBeCloseTo(r.total_intereses_desde * 0.21, 1);
  });
});
