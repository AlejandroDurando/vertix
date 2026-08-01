import { NextRequest } from "next/server";
import { fail } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { nombreArchivoNota, notaEpymeDocx, type NotaEpymeInput } from "@/lib/nota-epyme";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Genera la Nota de Adhesión EPYME en Word con los datos que la persona ya
 * cargó en el formulario. Se hace en el servidor porque el navegador le agrega
 * encabezado y pie a todo lo que imprime y eso ensuciaba el PDF.
 */
export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`nota-epyme:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  let body: NotaEpymeInput;
  try {
    body = (await req.json()) as NotaEpymeInput;
  } catch {
    return fail("Body inválido (JSON esperado)", 400);
  }

  if (body?.alyc !== "adcap" && body?.alyc !== "sailing") {
    return fail("Sociedad de bolsa inválida", 400, "alyc");
  }

  try {
    const buffer = await notaEpymeDocx(body);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${nombreArchivoNota(body)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("nota-epyme", "No se pudo generar la nota", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos generar la nota en este momento.", 500);
  }
}
