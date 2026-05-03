import { NextRequest } from "next/server";
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
  firstZodError,
  precalificacionSchema,
} from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { appendPrecalificacion } from "@/lib/sheets-crm";
import { emailPrecalificacion } from "@/lib/email";
import { upsertHubspotContact } from "@/lib/hubspot";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedBody = {
  data: Record<string, unknown>;
  archivo?: {
    nombre: string;
    tipo: string;
    tamano: number;
    base64: string;
  };
};

async function parseBody(req: NextRequest): Promise<ParsedBody | { error: string }> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await req.json()) as Record<string, unknown>;
      return { data: json };
    } catch {
      return { error: "Body inválido (JSON esperado)" };
    }
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const data: Record<string, unknown> = {};
    let archivo: ParsedBody["archivo"];

    for (const [key, raw] of form.entries()) {
      if (raw instanceof File) {
        if (key !== "archivo") continue;
        if (raw.size === 0) continue;
        if (raw.size > MAX_FILE_SIZE)
          return { error: "El archivo supera el tamaño máximo de 5MB" };
        if (!ALLOWED_FILE_TYPES.includes(raw.type))
          return { error: "Formato de archivo no permitido (PDF o imagen)" };
        const buffer = Buffer.from(await raw.arrayBuffer());
        archivo = { nombre: raw.name, tipo: raw.type, tamano: raw.size, base64: buffer.toString("base64") };
        continue;
      }
      const value = String(raw);
      if (["monto_cheque", "monto_solicitado", "plazo_meses"].includes(key)) {
        const n = Number(value);
        data[key] = Number.isFinite(n) ? n : value;
      } else {
        data[key] = value;
      }
    }
    return { data, archivo };
  }

  return { error: "Content-Type no soportado" };
}

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`precalificacion:${ip}`);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  const parsedBody = await parseBody(req);
  if ("error" in parsedBody) return fail(parsedBody.error, 400);

  const validated = precalificacionSchema.safeParse(parsedBody.data);
  if (!validated.success) {
    const { message, field } = firstZodError(validated.error);
    return fail(message, 400, field);
  }

  const data = validated.data;
  const sentAt = new Date().toISOString();

  if (data.servicio === "prestamos" && !parsedBody.archivo) {
    return fail("El archivo es requerido para préstamos", 400, "archivo");
  }

  const archivoMeta = parsedBody.archivo
    ? { nombre: parsedBody.archivo.nombre, tipo: parsedBody.archivo.tipo, tamano: parsedBody.archivo.tamano }
    : undefined;

  // Fire-and-forget: sheet + email + hubspot
  appendPrecalificacion(data, sentAt).catch(() => null);

  emailPrecalificacion({
    ...data,
    ...(archivoMeta ? { archivo: archivoMeta } : {}),
  }).catch(() => null);

  upsertHubspotContact({
    email: data.email,
    firstName: data.nombre,
    phone: data.telefono,
    company: data.servicio === "cheques" ? data.empresa : undefined,
    servicio: data.servicio,
    extra: data.servicio === "cheques"
      ? { monto_cheque: data.monto_cheque, tipo_cheque: data.tipo_cheque, banco_emisor: data.banco_emisor, fecha_vencimiento: data.fecha_vencimiento }
      : { tipo_persona: data.tipo_persona, monto_solicitado: data.monto_solicitado, plazo_meses: data.plazo_meses, tipo_ingreso: data.tipo_ingreso },
  }).catch(() => null);

  logger.info("precalificacion", "Solicitud recibida", { servicio: data.servicio, archivo: archivoMeta });

  return ok({ recibido: true, servicio: data.servicio, archivo: archivoMeta });
}
