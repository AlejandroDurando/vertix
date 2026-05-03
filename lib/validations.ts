import { z } from "zod";

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

export const contactoSchema = z.object({
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  empresa: trimmed(160).optional().or(z.literal("").transform(() => undefined)),
  asunto: trimmed(160),
  mensaje: trimmed(4000, 5),
});

export type ContactoInput = z.infer<typeof contactoSchema>;

const fechaSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (formato YYYY-MM-DD)")
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "Fecha inválida");

const montoSchema = z
  .number({ invalid_type_error: "Monto inválido" })
  .positive("El monto debe ser mayor a 0")
  .finite();

export const precalificacionChequesSchema = z.object({
  servicio: z.literal("cheques"),
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  empresa: trimmed(160),
  monto_cheque: montoSchema,
  fecha_vencimiento: fechaSchema,
  banco_emisor: trimmed(120),
  tipo_cheque: z.enum(["propio", "tercero"]),
});

export const precalificacionPrestamosSchema = z.object({
  servicio: z.literal("prestamos"),
  nombre: trimmed(120),
  email: emailSchema,
  telefono: telefonoSchema,
  tipo_persona: z.enum(["humana", "empresa"]),
  monto_solicitado: montoSchema,
  plazo_meses: z
    .number({ invalid_type_error: "Plazo inválido" })
    .int("El plazo debe ser un número entero")
    .min(1, "El plazo mínimo es 1 mes")
    .max(120, "El plazo máximo es 120 meses"),
  tipo_ingreso: z.enum(["relacion_dependencia", "monotributo", "empresa"]),
});

export const precalificacionSchema = z.discriminatedUnion("servicio", [
  precalificacionChequesSchema,
  precalificacionPrestamosSchema,
]);

export type PrecalificacionInput = z.infer<typeof precalificacionSchema>;

export const simuladorChequesSchema = z.object({
  tipo: z.literal("cheques"),
  monto: montoSchema,
  dias_vencimiento: z
    .number({ invalid_type_error: "Días inválidos" })
    .int("Los días deben ser un número entero")
    .min(1, "Mínimo 1 día")
    .max(365, "Máximo 365 días"),
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

export const simuladorSchema = z.discriminatedUnion("tipo", [
  simuladorChequesSchema,
  simuladorPrestamosSchema,
]);

export type SimuladorInput = z.infer<typeof simuladorSchema>;

export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
