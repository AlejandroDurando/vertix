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

  // Sheets primero (awaited — en serverless el fire-and-forget se cancela)
  await appendContacto(data, sentAt).catch(() => null);

  // Email y HubSpot en paralelo, no bloquean respuesta si fallan
  emailContacto(data).catch(() => null);
  upsertHubspotContact({
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
