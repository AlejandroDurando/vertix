import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, firstZodError } from "@/lib/validations";
import { construirClave, firmarSubida, storageHabilitado } from "@/lib/storage";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  tramite: z.enum(["alta", "precalificacion"]),
  campo: z.string().trim().min(1).max(60),
  nombre: z.string().trim().min(1).max(200),
  tipo: z.string().trim().refine((t) => ALLOWED_FILE_TYPES.includes(t), {
    message: "Tipo de archivo no permitido (PDF o imagen)",
  }),
  tamano: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE, "El archivo supera el tamaño máximo permitido"),
});

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  // Un alta completa pide hasta ~10 documentos; el tope contempla reintentos.
  const rl = checkRateLimit(`firmar:${ip}`, 40, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  if (!storageHabilitado()) {
    // El formulario interpreta este estado y manda los archivos por el camino
    // viejo (dentro del multipart).
    return fail("almacenamiento no configurado", 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Body inválido (JSON esperado)", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const { message, field } = firstZodError(parsed.error);
    return fail(message, 400, field);
  }

  const { tramite, campo, nombre, tipo } = parsed.data;
  const clave = construirClave({ tramite, campo, nombre });

  try {
    const url = await firmarSubida({ clave, tipo });
    return ok({ url, clave });
  } catch (err) {
    logger.error("storage", "No se pudo firmar la subida", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos preparar la subida del archivo.", 500);
  }
}
