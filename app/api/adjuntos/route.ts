import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { firmarDescarga, storageHabilitado, tokenValido } from "@/lib/storage";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga de un adjunto del legajo. Es el enlace que queda guardado en el CRM
 * y en los emails internos: no expira, pero exige el token derivado del
 * secreto del servidor. Redirige a una URL firmada de vida corta, así el
 * bucket nunca queda expuesto.
 */
export async function GET(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`adjuntos:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  if (!storageHabilitado()) {
    return fail("Almacenamiento no configurado.", 503);
  }

  const clave = req.nextUrl.searchParams.get("clave") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";

  if (!clave || !token || !tokenValido(clave, token)) {
    logger.warn("storage", "Intento de descarga con token inválido", { ip });
    return fail("Enlace inválido.", 403);
  }

  try {
    const url = await firmarDescarga(clave);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    logger.error("storage", "No se pudo firmar la descarga", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos abrir el documento.", 500);
  }
}
