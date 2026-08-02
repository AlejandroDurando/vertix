import { NextRequest } from "next/server";
import JSZip from "jszip";
import { fail } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import {
  leerObjeto,
  listarLegajo,
  storageHabilitado,
  tokenValido,
} from "@/lib/storage";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Descarga el legajo completo en un zip. Es lo que el equipo usa para armar la
 * carpeta que le manda a la sociedad de bolsa, en vez de bajar los documentos
 * de a uno.
 */
export async function GET(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`zip:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }
  if (!storageHabilitado()) return fail("Almacenamiento no configurado.", 503);

  const carpeta = req.nextUrl.searchParams.get("carpeta") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!carpeta || !token || !tokenValido(carpeta, token)) {
    logger.warn("storage", "Intento de descarga de legajo con token inválido", { ip });
    return fail("Enlace inválido.", 403);
  }

  try {
    const docs = await listarLegajo(carpeta);
    if (docs.length === 0) return fail("El legajo no tiene documentos.", 404);

    const zip = new JSZip();
    for (const d of docs) {
      zip.file(`${d.campo}-${d.nombre}`, await leerObjeto(d.clave));
    }
    const contenido = await zip.generateAsync({ type: "nodebuffer" });

    // El nombre del zip identifica el trámite: alta-2026-08-02-<id corto>.zip
    const [tramite, dia, id] = carpeta.split("/");
    const nombre = `${tramite}-${dia}-${(id ?? "").slice(0, 8)}.zip`;

    return new Response(new Uint8Array(contenido), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("storage", "No se pudo armar el zip del legajo", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos preparar la descarga.", 500);
  }
}
