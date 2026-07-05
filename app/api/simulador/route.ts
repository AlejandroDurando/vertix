import { NextRequest } from "next/server";
import { parseSimulador } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { getTasas } from "@/lib/tasas";
import { simularCheques, simularPrestamo } from "@/lib/simulador";
import { consultarBcra, evaluarBcra, infoBcra } from "@/lib/bcra";
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

  const parsed = parseSimulador(body);
  if (!parsed.success) {
    return fail(parsed.message, 400, parsed.field);
  }

  try {
    const tasas = await getTasas();

    if (parsed.data.tipo === "cheques") {
      // Verificación BCRA de ambos CUIT. El presupuesto no se emite si el
      // librador o el endosatario están en situación 3 o superior (CAMBIOS.md).
      const [libradorRes, endosatarioRes] = await Promise.all([
        consultarBcra(parsed.data.cuit_librador),
        consultarBcra(parsed.data.cuit_endosatario),
      ]);
      const evLibrador = evaluarBcra(libradorRes, "El librador del cheque");
      const evEndosatario = evaluarBcra(endosatarioRes, "El endosatario del cheque");
      const bloqueo =
        evLibrador.decision === "bloquear"
          ? { ev: evLibrador, res: libradorRes }
          : evEndosatario.decision === "bloquear"
            ? { ev: evEndosatario, res: endosatarioRes }
            : null;

      if (bloqueo) {
        logger.info("simulador", "Presupuesto bloqueado por BCRA", {
          cuit: bloqueo.res.cuit,
          situacion: bloqueo.res.situacionMaxima,
        });
        return fail(bloqueo.ev.motivo, 403);
      }

      const result = simularCheques(parsed.data, tasas);
      return ok({
        ...result,
        bcra: {
          librador: infoBcra(libradorRes, "El librador"),
          endosatario: infoBcra(endosatarioRes, "El endosatario"),
        },
      });
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
