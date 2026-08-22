import { NextRequest } from "next/server";
import { fechaConcertacion, parseLote } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { getTasas } from "@/lib/tasas";
import { cotizarLote } from "@/lib/lote";
import { consultarBcra, infoBcra } from "@/lib/bcra";
import { logger } from "@/lib/logger";
import type { BcraInfo } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`lote:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Body inválido (JSON esperado)", 400);
  }

  const parsed = parseLote(body);
  if (!parsed.success) {
    return fail(parsed.message, 400, parsed.field);
  }

  const input = parsed.data;

  try {
    const tasas = await getTasas();
    const lote = cotizarLote(input, tasas, fechaConcertacion(input.concertacion));

    // Una consulta por CUIT distinto: diez cheques del mismo librador son una
    // sola llamada al BCRA, no diez.
    const cuits = Array.from(
      new Set(
        [...input.filas.map((f) => f.cuit_librador), input.cuit_endosatario].filter(
          (c): c is string => Boolean(c)
        )
      )
    );
    const consultas = new Map<string, BcraInfo>();
    await Promise.all(
      cuits.map(async (cuit) => {
        const esVendedor = cuit === input.cuit_endosatario;
        const r = await consultarBcra(cuit);
        consultas.set(
          cuit,
          // El librador se marca en rojo si está mal, pero **nunca** frena el
          // lote: bloquear diez cheques por uno no tiene sentido, y el equipo
          // decide con el dato a la vista. El vendedor es sólo informativo.
          infoBcra(
            r,
            esVendedor ? "El endosatario" : "El librador",
            esVendedor ? { soloInformativo: true } : undefined
          )
        );
      })
    );

    const filas = lote.filas.map((fila) => {
      const info = fila.cuit_librador ? consultas.get(fila.cuit_librador) : undefined;
      return info ? { ...fila, bcra: info } : fila;
    });

    const endosatario = input.cuit_endosatario
      ? consultas.get(input.cuit_endosatario)
      : undefined;

    logger.info("lote", "Lote cotizado", {
      filas: filas.length,
      modalidad: input.modalidad,
      instrumento: input.instrumento,
    });

    return ok({
      ...lote,
      filas,
      ...(endosatario ? { bcra_endosatario: endosatario } : {}),
    });
  } catch (err) {
    logger.error("lote", "Error al cotizar el lote", {
      err: err instanceof Error ? err.message : String(err),
    });
    return fail("No pudimos cotizar el lote en este momento.", 500);
  }
}
