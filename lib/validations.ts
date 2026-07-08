import { z } from "zod";
import { esCuitValido, normalizarCuit } from "./cuit";
import { diasHabilesEntre, hoy, parseISODate } from "./fechas";

/** Días hábiles mínimos entre hoy y la fecha de pago del cheque. */
export const MIN_DIAS_HABILES = 5;

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

const fechaPagoChequeSchema = fechaSchema.refine(
  (v) => diasHabilesEntre(hoy(), parseISODate(v)) >= MIN_DIAS_HABILES,
  `Por este medio no se descuentan cheques con vencimiento menor a ${MIN_DIAS_HABILES} días hábiles. Comunicate con nosotros y podemos ver otra manera de negociación.`
);

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
  monto_cheque: montoSchema,
  fecha_pago: fechaPagoChequeSchema,
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
  plazo_meses: z
    .number({ invalid_type_error: "Plazo inválido" })
    .int("El plazo debe ser un número entero")
    .min(1, "El plazo mínimo es 1 mes")
    .max(120, "El plazo máximo es 120 meses"),
  tipo_ingreso: z.enum(["relacion_dependencia", "monotributo", "empresa"]),
});

export const precalificacionSchema = z
  .discriminatedUnion("servicio", [
    precalificacionChequesSchema,
    precalificacionPrestamosSchema,
  ])
  .superRefine((data, ctx) => {
    if (
      data.servicio === "cheques" &&
      normalizarCuit(data.cuit_librador) === normalizarCuit(data.cuit_endosatario)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cuit_endosatario"],
        message:
          "El librador y el endosatario no pueden coincidir: no se descuentan cheques propios.",
      });
    }
  });

export type PrecalificacionInput = z.infer<typeof precalificacionSchema>;

// --- Simulador ---
export const simuladorChequesSchema = z
  .object({
    tipo: z.literal("cheques"),
    monto: montoSchema,
    fecha_pago: fechaPagoChequeSchema,
    modalidad: z.enum(["directo", "comitente"]),
    instrumento: z.enum(["cheque", "echeq", "fce"]),
    cuit_librador: cuitSchema,
    cuit_endosatario: cuitSchema,
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
  });

export const simuladorPrestamosSchema = z.object({
  tipo: z.literal("prestamos"),
  monto: montoSchema,
  plazo_meses: z
    .number({ invalid_type_error: "Plazo inválido" })
    .int("El plazo debe ser un número entero")
    .min(1, "El plazo mínimo es 1 mes")
    .max(120, "El plazo máximo es 120 meses"),
  tipo_persona: z.enum(["humana", "empresa"]),
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
    cbu: cbuSchema,
    email: emailSchema,
    email_alternativo: emailSchema,
    telefono: telefonoSchema,
    es_pep: siNo,
    // Firmante / apoderado
    referente_nombre: requerido(160),
    referente_cargo: requerido(80),
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
