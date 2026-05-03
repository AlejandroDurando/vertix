import { NextRequest } from "next/server";
import { firstZodError, simuladorSchema } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { getTasas } from "@/lib/tasas";
import { simularCheques, simularPrestamo } from "@/lib/simulador";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`simulador:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Body inválido (JSON esperado)", 400);
  }

  const parsed = simuladorSchema.safeParse(body);
  if (!parsed.success) {
    const { message, field } = firstZodError(parsed.error);
    return fail(message, 400, field);
  }

  try {
    const tasas = await getTasas();

    if (parsed.data.tipo === "cheques") {
      const result = simularCheques(parsed.data, tasas);
      return ok(result);
    }

    const result = simularPrestamo(parsed.data, tasas);
    return ok(result);
  } catch (err) {
    logger.error("simulador", "Error en simulación", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos calcular la simulación en este momento.", 500);
  }
}
