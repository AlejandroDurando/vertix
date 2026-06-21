import { NextRequest } from "next/server";
import { firstZodError, precalificacionSchema } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { readUploads, type ParsedFile } from "@/lib/uploads";
import { appendPrecalificacion } from "@/lib/sheets-crm";
import { emailPrecalificacion } from "@/lib/email";
import { upsertHubspotContact } from "@/lib/hubspot";
import { consultarBcra, evaluarBcra } from "@/lib/bcra";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_FIELDS = ["documentacion", "titulo_automotor", "constancia_cuit"];
const NUMERIC_FIELDS = ["monto_cheque", "monto_solicitado", "plazo_meses"];

type Parsed =
  | { data: Record<string, unknown>; files: Record<string, ParsedFile> }
  | { error: string };

async function parseBody(req: NextRequest): Promise<Parsed> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await req.json()) as Record<string, unknown>;
      return { data: json, files: {} };
    } catch {
      return { error: "Body inválido (JSON esperado)" };
    }
  }

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    return readUploads(form, { numericFields: NUMERIC_FIELDS, fileFields: FILE_FIELDS });
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

  const parsed = await parseBody(req);
  if ("error" in parsed) return fail(parsed.error, 400);

  const validated = precalificacionSchema.safeParse(parsed.data);
  if (!validated.success) {
    const { message, field } = firstZodError(validated.error);
    return fail(message, 400, field);
  }

  const data = validated.data;
  const files = parsed.files;
  const sentAt = new Date().toISOString();

  // Validación de adjuntos obligatorios para préstamos.
  if (data.servicio === "prestamos") {
    if (!files.documentacion) {
      return fail("Adjuntá la documentación de respaldo.", 400, "documentacion");
    }
    if (data.tipo_prestamo === "prendario" && !files.titulo_automotor) {
      return fail(
        "Para préstamos prendarios el título del automotor es obligatorio.",
        400,
        "titulo_automotor"
      );
    }
  }

  // Enriquecimiento BCRA (informativo, no bloquea la precalificación).
  let bcraResumen: string | undefined;
  if (data.servicio === "cheques") {
    try {
      const bcra = await consultarBcra(data.cuit_librador);
      const ev = evaluarBcra(bcra, "Librador");
      if (bcra.disponible) {
        bcraResumen = `Situación máx. ${bcra.situacionMaxima ?? "?"}${
          bcra.chequesRechazadosImpagos ? " · cheques rechazados impagos" : ""
        } — ${ev.decision.toUpperCase()}`;
      }
    } catch {
      // best-effort
    }
  }

  const adjuntos = Object.entries(files).map(([campo, f]) => ({
    campo,
    nombre: f.nombre,
    tipo: f.tipo,
    tamano: f.tamano,
    base64: f.base64,
  }));

  // Sheets awaited — en serverless el fire-and-forget se cancela.
  await appendPrecalificacion(data, sentAt, {
    adjuntos: adjuntos.map((a) => a.campo),
    bcra: bcraResumen,
  }).catch(() => null);

  emailPrecalificacion(
    { ...data, ...(bcraResumen ? { bcra: bcraResumen } : {}) },
    adjuntos.map((a) => ({ filename: `${a.campo}-${a.nombre}`, content: a.base64 }))
  ).catch(() => null);

  upsertHubspotContact({
    email: data.email,
    firstName: data.nombre,
    phone: data.telefono,
    company: data.servicio === "cheques" ? data.empresa : undefined,
    servicio: data.servicio,
    extra:
      data.servicio === "cheques"
        ? {
            monto_cheque: data.monto_cheque,
            banco_emisor: data.banco_emisor,
            fecha_pago: data.fecha_pago,
            cuit_librador: data.cuit_librador,
            cuit_endosatario: data.cuit_endosatario,
          }
        : {
            tipo_persona: data.tipo_persona,
            tipo_prestamo: data.tipo_prestamo,
            cuit_solicitante: data.cuit_solicitante,
            monto_solicitado: data.monto_solicitado,
            plazo_meses: data.plazo_meses,
            tipo_ingreso: data.tipo_ingreso,
          },
  }).catch(() => null);

  logger.info("precalificacion", "Solicitud recibida", {
    servicio: data.servicio,
    adjuntos: adjuntos.map((a) => a.campo),
    bcra: bcraResumen,
  });

  return ok({ recibido: true, servicio: data.servicio });
}
