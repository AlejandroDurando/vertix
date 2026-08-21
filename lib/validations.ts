import { z } from "zod";
import { esCuitValido, normalizarCuit } from "./cuit";
import {
  esDiaHabil,
  hoy,
  parseISODate,
  sumarDiasHabiles,
} from "./fechas";
import type { InstrumentoCheque, ModalidadCheque } from "@/types";

/**
 * Plazos que se ofrecen, en meses. Es un desplegable y no un campo libre
 * (cliente, 20/08/2026): son los plazos que realmente se otorgan, y más de 24
 * no se toma.
 */
export const PLAZOS_MESES = [6, 12, 18, 24] as const;

export const PLAZO_MAX_MESES = Math.max(...PLAZOS_MESES);

/** Opciones del desplegable, compartidas por el simulador y la precalificación. */
export const PLAZO_OPCIONES = PLAZOS_MESES.map((meses) => ({
  value: String(meses),
  label: `${meses} meses`,
}));

const plazoSchema = z
  .number({ invalid_type_error: "Plazo inválido" })
  .int("El plazo debe ser un número entero")
  .refine(
    (v) => (PLAZOS_MESES as readonly number[]).includes(v),
    `El plazo tiene que ser de ${PLAZOS_MESES.join(", ")} meses`
  );

/** Días hábiles mínimos entre hoy y la fecha de pago del cheque. */
export const MIN_DIAS_HABILES = 5;

/**
 * Día en que se concierta la operación.
 *
 * El simulador interno puede pararse en el día siguiente: muchos clientes
 * deciden vender recién mañana y hay que reprogramar la liquidación de los
 * fondos (pedido del cliente, 13/08/2026). Si mañana no es hábil se toma el
 * próximo día hábil, porque ni el mercado ni el banco liquidan un sábado.
 */
export type Concertacion = "hoy" | "manana";

export function fechaConcertacion(
  concertacion?: Concertacion,
  ahora: Date = hoy()
): Date {
  return concertacion === "manana" ? sumarDiasHabiles(ahora, 1) : ahora;
}

/**
 * Parte de una FCE que el comprador acepta habitualmente ("por lo general el
 * saldo aceptado es el 80%", cliente 13/08/2026). Es sólo lo que se precarga en
 * el formulario: el importe real se puede corregir siempre, porque cambia de
 * operación en operación.
 */
export const PORCENTAJE_ACEPTADO_FCE = 80;

/** Valor aceptado sugerido de una FCE, redondeado a centavos. */
export function valorAceptadoSugerido(montoTotal: number): number {
  return Math.round(montoTotal * PORCENTAJE_ACEPTADO_FCE) / 100;
}

/**
 * El mínimo de días hábiles lo impone el mercado de capitales, así que sólo
 * aplica a lo que se negocia ahí. Por fuera (directo con Vertix) se pueden
 * tomar valores con menor plazo de vencimiento.
 *
 * Simulador y precalificación piden la modalidad, así que ambos deciden por
 * ella: el piso rige sólo con cuenta comitente.
 */
export const modalidadRequiereMinDias = (m: ModalidadCheque) => m === "comitente";

/** Etiquetas de la modalidad, compartidas por el simulador y la precalificación. */
export const MODALIDAD_OPCIONES = [
  { value: "directo", label: "Sin cuenta comitente en el mercado de capitales" },
  { value: "comitente", label: "Con cuenta comitente en el mercado de capitales" },
];

/**
 * En el mercado de capitales sólo se negocian echeq y FCE: el cheque físico se
 * opera únicamente directo con Vertix.
 */
export const instrumentoSoloDirecto = (i: InstrumentoCheque) => i === "cheque";

/** La FCE sólo se negocia en el mercado de capitales, no directo con Vertix. */
export const instrumentoSoloComitente = (i: InstrumentoCheque) => i === "fce";

export const MSG_CHEQUE_SOLO_DIRECTO =
  'El cheque físico se opera únicamente sin cuenta comitente: en el mercado de capitales sólo se negocian echeq y FCE. Elegí "Sin cuenta comitente en el mercado de capitales" o cambiá el instrumento.';

export const MSG_FCE_SOLO_COMITENTE =
  "La FCE se negocia únicamente en el mercado de capitales, con cuenta comitente. Elegí esa modalidad o cambiá el instrumento.";

/**
 * Vencimiento más cercano que se puede tomar con cuenta comitente.
 *
 * Los 5 días hábiles se cuentan **incluyendo el día de la operación** (cliente,
 * 19/08/2026: "si hoy vendiéramos un cheque el vencimiento mínimo debería ser
 * 25/8, son 5 días hábiles contemplando hoy" — dicho un miércoles 19). Antes se
 * contaban a partir del día siguiente y el simulador exigía un día de más, así
 * que rechazaba operaciones que sí se pueden hacer.
 *
 * Si el día de la operación no es hábil no cuenta, y los 5 salen enteros de los
 * días siguientes.
 */
export function fechaPagoMinima(ahora: Date = hoy()): Date {
  return sumarDiasHabiles(ahora, MIN_DIAS_HABILES - (esDiaHabil(ahora) ? 1 : 0));
}

export function cumpleMinDiasHabiles(fechaISO: string, ahora: Date = hoy()): boolean {
  return parseISODate(fechaISO) >= fechaPagoMinima(ahora);
}

export const MSG_MIN_DIAS_COMITENTE = `Con cuenta comitente no podemos tomar valores con vencimiento a menos de ${MIN_DIAS_HABILES} días hábiles, contando el día de la operación. Elegí "Sin cuenta comitente en el mercado de capitales" o comunicate con nosotros para ver otra manera de negociación.`;

const trimmed = (max: number, min = 1) =>
  z.string().trim().min(min).max(max);

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email inválido")
  .max(254);

const telefonoSchema = z
  .string()
  .trim()
  .min(6, "Teléfono inválido")
  .max(30)
  .regex(/^[+\d\s()-]+$/, "Teléfono inválido");

const cuitSchema = z
  .string()
  .trim()
  .min(1, "CUIT/CUIL requerido")
  .transform(normalizarCuit)
  .refine(esCuitValido, "CUIT/CUIL inválido (revisá los 11 dígitos)");

const fechaSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato YYYY-MM-DD)")
  .refine((v) => !Number.isNaN(parseISODate(v).getTime()), "Fecha inválida");

const montoSchema = z
  .number({ invalid_type_error: "Monto inválido" })
  .positive("El monto debe ser mayor a 0")
  .finite();

// --- Contacto ---
export const contactoSchema = z.object({
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  empresa: trimmed(160).optional().or(z.literal("").transform(() => undefined)),
  asunto: trimmed(160),
  mensaje: trimmed(4000, 5),
});

export type ContactoInput = z.infer<typeof contactoSchema>;

// --- Precalificación ---
export const precalificacionChequesSchema = z.object({
  servicio: z.literal("cheques"),
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  empresa: trimmed(160), // PF: "Titular" o su nombre
  instrumento: z.enum(["cheque", "echeq", "fce"]),
  modalidad: z.enum(["directo", "comitente"]),
  monto_cheque: montoSchema,
  // Sólo FCE: lo que el comprador aceptó, que es lo que se negocia. Se pide
  // también acá para que el lead llegue con el dato de la operación real
  // (pedido del cliente, 13/08/2026). Obligatorio para FCE (ver superRefine).
  // El preprocess es porque el formulario viaja como multipart: un campo vacío
  // llega como "" y `readUploads` lo convierte en 0, que acá es "no vino".
  monto_aceptado: z.preprocess(
    (v) => (v === "" || v === 0 ? undefined : v),
    montoSchema.optional()
  ),
  fecha_pago: fechaSchema,
  banco_emisor: trimmed(120),
  cuit_librador: cuitSchema,
  cuit_endosatario: cuitSchema,
});

export const precalificacionPrestamosSchema = z.object({
  servicio: z.literal("prestamos"),
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  tipo_persona: z.enum(["humana", "empresa"]),
  tipo_prestamo: z.enum(["personal", "prendario"]),
  cuit_solicitante: cuitSchema,
  monto_solicitado: montoSchema,
  plazo_meses: plazoSchema,
  tipo_ingreso: z.enum(["relacion_dependencia", "monotributo", "empresa"]),
});

export const precalificacionSchema = z
  .discriminatedUnion("servicio", [
    precalificacionChequesSchema,
    precalificacionPrestamosSchema,
  ])
  .superRefine((data, ctx) => {
    if (data.servicio !== "cheques") return;

    if (normalizarCuit(data.cuit_librador) === normalizarCuit(data.cuit_endosatario)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cuit_endosatario"],
        message:
          "El librador y el endosatario no pueden coincidir: no se descuentan cheques propios.",
      });
    }

    // Mismas reglas que el simulador: el instrumento limita la modalidad, y el
    // mínimo de días lo exige el mercado de capitales (sólo comitente).
    if (instrumentoSoloDirecto(data.instrumento) && data.modalidad === "comitente") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalidad"],
        message: MSG_CHEQUE_SOLO_DIRECTO,
      });
      return;
    }

    if (instrumentoSoloComitente(data.instrumento) && data.modalidad === "directo") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalidad"],
        message: MSG_FCE_SOLO_COMITENTE,
      });
      return;
    }

    // En la FCE lo que se negocia es el valor aceptado, no el total facturado.
    if (data.instrumento === "fce") {
      if (data.monto_aceptado == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monto_aceptado"],
          message: "Indicá el valor aceptado de la FCE.",
        });
      } else if (data.monto_aceptado > data.monto_cheque) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monto_aceptado"],
          message: "El valor aceptado no puede superar el total de la factura.",
        });
      }
    }

    if (
      modalidadRequiereMinDias(data.modalidad) &&
      !cumpleMinDiasHabiles(data.fecha_pago)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fecha_pago"],
        message: MSG_MIN_DIAS_COMITENTE,
      });
    }
  });

export type PrecalificacionInput = z.infer<typeof precalificacionSchema>;

// --- Simulador ---
export const simuladorChequesSchema = z
  .object({
    tipo: z.literal("cheques"),
    monto: montoSchema,
    // Sólo FCE: la parte de la factura que el comprador aceptó, que es lo que
    // se negocia. Obligatorio para FCE (ver superRefine).
    monto_aceptado: montoSchema.optional(),
    fecha_pago: fechaSchema,
    modalidad: z.enum(["directo", "comitente"]),
    instrumento: z.enum(["cheque", "echeq", "fce"]),
    cuit_librador: cuitSchema,
    cuit_endosatario: cuitSchema,
    // Sólo llega desde el simulador interno; desde la web se cotiza el peor
    // caso ("ri", el default) porque el comprador todavía no está definido.
    condicion_comprador: z.enum(["ri", "mono_cf"]).optional(),
    // También sólo del simulador interno: cotizar como si la operación se
    // concertara mañana. Desde la web siempre es hoy.
    concertacion: z.enum(["hoy", "manana"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (normalizarCuit(data.cuit_librador) === normalizarCuit(data.cuit_endosatario)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cuit_endosatario"],
        message:
          "El librador y el endosatario no pueden coincidir: no se descuentan cheques propios.",
      });
    }

    if (instrumentoSoloDirecto(data.instrumento) && data.modalidad === "comitente") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalidad"],
        message: MSG_CHEQUE_SOLO_DIRECTO,
      });
      return; // el mínimo de días no aplica a una combinación inválida
    }

    if (instrumentoSoloComitente(data.instrumento) && data.modalidad === "directo") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modalidad"],
        message: MSG_FCE_SOLO_COMITENTE,
      });
      return;
    }

    // En la FCE se negocia lo que el comprador aceptó, no el total facturado.
    if (data.instrumento === "fce") {
      if (data.monto_aceptado == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monto_aceptado"],
          message: "Indicá el valor aceptado de la FCE.",
        });
      } else if (data.monto_aceptado > data.monto) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["monto_aceptado"],
          message: "El valor aceptado no puede superar el total de la factura.",
        });
      }
    }

    // El piso de días hábiles se mide desde el día en que se concierta, que en
    // el simulador interno puede ser mañana.
    if (
      modalidadRequiereMinDias(data.modalidad) &&
      !cumpleMinDiasHabiles(data.fecha_pago, fechaConcertacion(data.concertacion))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fecha_pago"],
        message: MSG_MIN_DIAS_COMITENTE,
      });
    }
  });

// La tasa del préstamo no depende del tipo de persona (se cotiza un rango),
// así que el simulador ya no lo pide.
export const simuladorPrestamosSchema = z.object({
  tipo: z.literal("prestamos"),
  monto: montoSchema,
  plazo_meses: plazoSchema,
});

export type SimuladorInput =
  | z.infer<typeof simuladorChequesSchema>
  | z.infer<typeof simuladorPrestamosSchema>;

/**
 * Valida el body del simulador discriminando manualmente por `tipo`
 * (los esquemas con refinamientos no se pueden combinar en discriminatedUnion).
 */
export function parseSimulador(
  body: unknown
):
  | { success: true; data: SimuladorInput }
  | { success: false; message: string; field?: string } {
  const tipo = (body as { tipo?: unknown } | null)?.tipo;
  const schema =
    tipo === "cheques"
      ? simuladorChequesSchema
      : tipo === "prestamos"
        ? simuladorPrestamosSchema
        : null;

  if (!schema) {
    return { success: false, message: 'Tipo de simulación inválido', field: "tipo" };
  }

  const parsed = schema.safeParse(body);
  if (parsed.success) return { success: true, data: parsed.data };
  const { message, field } = firstZodError(parsed.error);
  return { success: false, message, field };
}

// --- Alta de cuenta comitente (AdCap / Sailing) ---
const requerido = (max = 160) => z.string().trim().min(1, "Campo obligatorio").max(max);
const dniSchema = z.string().trim().regex(/^\d{7,8}$/, "DNI inválido (7 u 8 dígitos)");
const cbuSchema = z.string().trim().regex(/^\d{22}$/, "CBU inválido (22 dígitos)");
const siNo = z.enum(["si", "no"]);
const alycSchema = z.enum(["adcap", "sailing"]);
const estadoCivilSchema = z.enum([
  "soltero",
  "casado",
  "divorciado",
  "viudo",
  "union",
]);
const tipoSocietarioSchema = z.enum(["sa", "sas", "srl", "otra"]);

/**
 * Carácter con el que firma el representante de una persona jurídica. Se
 * guardan las etiquetas tal cual porque van impresas en la Nota EPYME.
 */
export const CARGOS_FIRMANTE = [
  "Socio gerente",
  "Apoderado",
  "Presidente",
  "Director",
  "Administrador titular",
] as const;

export const altaPersonaFisicaSchema = z
  .object({
    tipo: z.literal("fisica"),
    alyc: alycSchema,
    nombre: requerido(120),
    apellido: requerido(120),
    cuit: cuitSchema,
    dni: dniSchema,
    fecha_nacimiento: fechaSchema,
    estado_civil: estadoCivilSchema,
    nacimiento_provincia: requerido(120),
    nacimiento_localidad: requerido(120),
    domicilio: requerido(200),
    localidad: requerido(120),
    provincia: requerido(120),
    codigo_postal: requerido(12),
    profesion: requerido(160),
    es_autonomo: siNo,
    // Régimen Simplificado de DDJJ de Impuesto a las Ganancias (no es el
    // régimen general). Si adhiere, debe adjuntar la constancia de adhesión.
    regimen_simplificado_ganancias: siNo,
    cbu: cbuSchema,
    email: emailSchema,
    email_alternativo: emailSchema,
    telefono: telefonoSchema,
    es_pep: siNo,
    // Sailing: define si debe adjuntar un servicio a su nombre.
    domicilio_dni_actual: siNo.optional(),
    // Cónyuge (obligatorio si está casado/a)
    conyuge_nombre: requerido(160).optional().or(z.literal("")),
    conyuge_dni: z.union([dniSchema, z.literal("")]).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.estado_civil === "casado") {
      if (!d.conyuge_nombre)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conyuge_nombre"], message: "Requerido para casados/as" });
      if (!d.conyuge_dni)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conyuge_dni"], message: "Requerido para casados/as" });
    }
    if (d.alyc === "sailing" && !d.domicilio_dni_actual) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["domicilio_dni_actual"],
        message: "Indicá si el domicilio de tu DNI es el actual",
      });
    }
  });

export const altaPersonaJuridicaSchema = z
  .object({
    tipo: z.literal("juridica"),
    alyc: alycSchema,
    razon_social: requerido(200),
    cuit: cuitSchema,
    tipo_societario: tipoSocietarioSchema,
    fecha_constitucion: fechaSchema,
    domicilio_legal: requerido(200),
    localidad: requerido(120),
    provincia: requerido(120),
    codigo_postal: requerido(12),
    actividad: requerido(160),
    // Define qué respaldo contable se pide: el balance o las DDJJ de IVA.
    tiene_eecc: siNo,
    cbu: cbuSchema,
    email: emailSchema,
    email_alternativo: emailSchema,
    telefono: telefonoSchema,
    es_pep: siNo,
    // Firmante / apoderado
    referente_nombre: requerido(160),
    // Carácter con el que firma. Es una lista cerrada (pedido del cliente) para
    // evitar erratas: el valor se usa tal cual en la Nota de Adhesión EPYME.
    referente_cargo: z.enum(CARGOS_FIRMANTE),
    referente_cuit: cuitSchema,
    referente_dni: dniSchema,
    referente_estado_civil: estadoCivilSchema,
    referente_telefono: telefonoSchema,
    referente_email: emailSchema,
    // Datos de socios que no figuren en el estatuto
    datos_socios: requerido(2000),
    // Cónyuge del firmante (si casado/a)
    conyuge_nombre: requerido(160).optional().or(z.literal("")),
    conyuge_dni: z.union([dniSchema, z.literal("")]).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.referente_estado_civil === "casado") {
      if (!d.conyuge_nombre)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conyuge_nombre"], message: "Requerido si el firmante es casado/a" });
      if (!d.conyuge_dni)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["conyuge_dni"], message: "Requerido si el firmante es casado/a" });
    }
    // Las aperturas de personas jurídicas se realizan únicamente en AdCap
    // (Sailing sólo abre cuentas de personas físicas, salvo excepciones).
    if (d.alyc === "sailing") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alyc"],
        message:
          "Las cuentas de personas jurídicas se abren en AdCap. Para excepciones, contactanos.",
      });
    }
  });

export function parseAlta(
  body: unknown
):
  | { success: true; data: AltaInput }
  | { success: false; message: string; field?: string } {
  const tipo = (body as { tipo?: unknown } | null)?.tipo;
  const schema =
    tipo === "fisica"
      ? altaPersonaFisicaSchema
      : tipo === "juridica"
        ? altaPersonaJuridicaSchema
        : null;
  if (!schema) return { success: false, message: "Tipo de alta inválido", field: "tipo" };
  const parsed = schema.safeParse(body);
  if (parsed.success) return { success: true, data: parsed.data };
  const { message, field } = firstZodError(parsed.error);
  return { success: false, message, field };
}

export type AltaInput =
  | z.infer<typeof altaPersonaFisicaSchema>
  | z.infer<typeof altaPersonaJuridicaSchema>;

export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Todos los documentos llegan escaneados o fotografiados, incluida la Nota
 * EPYME: AdCap exige que se imprima y se firme a mano (confirmado el
 * 06/08/2026), así que Word no se acepta en ningún adjunto.
 */
export function tiposPermitidos(): string[] {
  return ALLOWED_FILE_TYPES;
}

/** Formatos aceptados en texto, para los mensajes de error. */
export function formatosPermitidos(): string {
  return "PDF o imagen";
}

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB por archivo

export function firstZodError(error: z.ZodError): {
  message: string;
  field?: string;
} {
  const issue = error.issues[0];
  if (!issue) return { message: "Datos inválidos" };
  return {
    message: issue.message,
    field: issue.path.join(".") || undefined,
  };
}
