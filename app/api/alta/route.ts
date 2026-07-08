import { NextRequest } from "next/server";
import { parseAlta } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { readUploads } from "@/lib/uploads";
import { appendAlta } from "@/lib/sheets-crm";
import { emailAlta, emailConfirmacionAlta } from "@/lib/email";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Adjuntos posibles (se valida cuáles son obligatorios según tipo/condiciones).
const FILE_FIELDS = [
  // Persona física
  "dni_frente",
  "dni_dorso",
  "constancia_cbu",
  "conyuge_dni_frente",
  "conyuge_dni_dorso",
  "nota_epyme_firmada",
  // Persona física — requisitos adicionales de Sailing
  "selfie_dni",
  "foto_aleatoria",
  "servicio_titular",
  "constancia_ingresos",
  // Persona jurídica
  "estatuto",
  "registro_acciones",
  "constancia_cuit",
  "dni_socios",
  "eecc",
  "ddjj",
];

const LABELS: Record<string, string> = {
  dni_frente: "DNI (frente)",
  dni_dorso: "DNI (dorso)",
  constancia_cbu: "Constancia de CBU",
  conyuge_dni_frente: "DNI del cónyuge (frente)",
  conyuge_dni_dorso: "DNI del cónyuge (dorso)",
  nota_epyme_firmada: "Nota de Adhesión EPYME firmada",
  selfie_dni: "Foto selfie con DNI",
  foto_aleatoria: "Foto aleatoria (ej. palma derecha levantada)",
  servicio_titular: "Servicio a nombre del titular",
  constancia_ingresos: "Últimos 3 recibos de sueldo o constancia de monotributo",
  estatuto: "Estatuto y modificaciones",
  registro_acciones: "Libro de Registro de Acciones",
  constancia_cuit: "Constancia de CUIT",
  dni_socios: "DNI de los socios",
  eecc: "Estados contables (CPCE)",
  ddjj: "Últimas 6 DDJJ de IVA e IIBB",
};

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`alta:${ip}`);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return fail("Content-Type no soportado (se espera multipart/form-data)", 400);
  }

  const form = await req.formData();
  const parsed = await readUploads(form, { fileFields: FILE_FIELDS });
  if ("error" in parsed) return fail(parsed.error, 400);

  const validated = parseAlta(parsed.data);
  if (!validated.success) {
    return fail(validated.message, 400, validated.field);
  }

  const data = validated.data;
  const files = parsed.files;

  // Adjuntos obligatorios según tipo y condiciones.
  const required: string[] = [];
  if (data.tipo === "fisica") {
    required.push("dni_frente", "dni_dorso", "constancia_cbu", "nota_epyme_firmada");
    if (data.estado_civil === "casado") {
      required.push("conyuge_dni_frente", "conyuge_dni_dorso");
    }
    // Requisitos adicionales de Sailing para personas físicas.
    if (data.alyc === "sailing") {
      required.push("selfie_dni", "foto_aleatoria");
      // Servicio a nombre del titular sólo si el domicilio del DNI no es el actual.
      if (data.domicilio_dni_actual === "no") {
        required.push("servicio_titular");
      }
      // Los recibos de sueldo/monotributo NO son bloqueantes: si no los tiene,
      // Sailing hace una búsqueda interna y asigna cupo según NSE.
    }
  } else {
    required.push(
      "estatuto",
      "constancia_cbu",
      "constancia_cuit",
      "dni_socios",
      "nota_epyme_firmada"
    );
    if (data.tipo_societario === "sa" || data.tipo_societario === "sas") {
      required.push("registro_acciones");
    }
    // EECC por CPCE o, en su defecto, las últimas 6 DDJJ de IVA/IIBB.
    if (!files.eecc && !files.ddjj) {
      return fail(
        "Adjuntá los estados contables (CPCE) o, en su defecto, las últimas 6 DDJJ de IVA e IIBB.",
        400,
        "eecc"
      );
    }
  }

  for (const campo of required) {
    if (!files[campo]) {
      return fail(`Falta adjuntar: ${LABELS[campo] ?? campo}.`, 400, campo);
    }
  }

  const sentAt = new Date().toISOString();
  const adjuntos = Object.entries(files).map(([campo, f]) => ({ campo, ...f }));

  // Todo awaited: en serverless los fire-and-forget se cancelan al responder.
  const [sheetsRes, emailRes] = await Promise.all([
    appendAlta(data, sentAt, adjuntos.map((a) => a.campo)),
    emailAlta(
      data,
      adjuntos.map((a) => ({ filename: `${a.campo}-${a.nombre}`, content: a.base64 }))
    ),
  ]);

  // El alta tiene que quedar registrada en al menos un destino.
  if (!sheetsRes.ok && !emailRes.ok) {
    logger.error("alta", "No se pudo registrar el alta en ningún destino", {
      sheets: sheetsRes.reason,
      email: emailRes.reason,
    });
    return fail(
      "No pudimos registrar tu solicitud en este momento. Intentá nuevamente en unos minutos.",
      503
    );
  }

  // Confirmación al solicitante (best-effort, pero awaited por serverless).
  const confirmacion = await emailConfirmacionAlta(data.email, {
    nombre: data.tipo === "fisica" ? `${data.nombre} ${data.apellido}` : data.razon_social,
    tipo: data.tipo,
    alyc: data.alyc,
    adjuntos: adjuntos.map((a) => LABELS[a.campo] ?? a.campo),
  }).catch(() => null);

  logger.info("alta", "Alta recibida", {
    tipo: data.tipo,
    alyc: data.alyc,
    adjuntos: adjuntos.map((a) => a.campo),
    confirmacion_enviada: confirmacion?.ok ?? false,
  });

  return ok({
    recibido: true,
    tipo: data.tipo,
    alyc: data.alyc,
    confirmacion_enviada: confirmacion?.ok ?? false,
  });
}
