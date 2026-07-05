import { NextRequest } from "next/server";
import { contactoSchema, firstZodError } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { appendContacto } from "@/lib/sheets-crm";
import { emailContacto } from "@/lib/email";
import { upsertHubspotContact } from "@/lib/hubspot";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`contacto:${ip}`);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Body inválido (JSON esperado)", 400);
  }

  const parsed = contactoSchema.safeParse(body);
  if (!parsed.success) {
    const { message, field } = firstZodError(parsed.error);
    return fail(message, 400, field);
  }

  const data = parsed.data;
  const sentAt = new Date().toISOString();

  // Todo awaited: en serverless los fire-and-forget se cancelan al responder.
  const [sheetsRes, emailRes] = await Promise.all([
    appendContacto(data, sentAt),
    emailContacto(data),
  ]);

  // La consulta tiene que quedar registrada en al menos un destino.
  if (!sheetsRes.ok && !emailRes.ok) {
    logger.error("contacto", "No se pudo registrar la consulta en ningún destino", {
      sheets: sheetsRes.reason,
      email: emailRes.reason,
    });
    return fail(
      "No pudimos registrar tu consulta en este momento. Intentá nuevamente en unos minutos.",
      503
    );
  }

  await upsertHubspotContact({
    email: data.email,
    firstName: data.nombre,
    phone: data.telefono,
    company: data.empresa,
    servicio: "contacto",
    extra: { asunto: data.asunto },
  }).catch(() => null);

  logger.info("contacto", "Formulario recibido", { asunto: data.asunto });

  return ok({ recibido: true });
}
