import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { FORMATOS_LECTURA, TIPOS_LECTURA, leerCheques } from "@/lib/lector-cheques";
import { MAX_FILE_SIZE } from "@/lib/validations";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lee los cheques de **un** archivo. Va de a uno para no acercarse nunca al
 * límite de 4,5MB de body de Vercel: el navegador los manda en secuencia y las
 * filas van apareciendo a medida que llegan.
 *
 * Nada de lo que entra acá se guarda: se lee y se descarta. No es un legajo, y
 * no guardarlo reduce la exposición de datos de terceros.
 */
export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`lote-leer:${ip}`, 60, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  let archivo: File | null = null;
  try {
    const form = await req.formData();
    const valor = form.get("archivo");
    if (valor instanceof File) archivo = valor;
  } catch {
    return fail("No pudimos leer el archivo enviado.", 400);
  }

  if (!archivo || archivo.size === 0) {
    return fail("Adjuntá un archivo.", 400, "archivo");
  }
  if (archivo.size > MAX_FILE_SIZE) {
    return fail("El archivo supera los 5MB.", 400, "archivo");
  }
  if (archivo.type && !TIPOS_LECTURA.includes(archivo.type)) {
    return fail(`Formato no admitido. Se aceptan ${FORMATOS_LECTURA}.`, 400, "archivo");
  }

  try {
    const resultado = await leerCheques({
      nombre: archivo.name,
      tipo: archivo.type,
      datos: new Uint8Array(await archivo.arrayBuffer()),
    });

    logger.info("lote", "Archivo leído", {
      via: resultado.via,
      cheques: resultado.cheques.length,
    });
    return ok(resultado);
  } catch (err) {
    logger.error("lote", "Error al leer el archivo", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos leer ese archivo. Probá con otro formato o cargalo a mano.", 500);
  }
}
