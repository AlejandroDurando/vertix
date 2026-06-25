/**
 * Consulta a la Central de Deudores del BCRA (API pública, sin credenciales).
 *
 *   GET /CentralDeDeudores/v1.0/Deudas/{cuit}
 *   GET /CentralDeDeudores/v1.0/Deudas/ChequesRechazados/{cuit}
 *
 * La situación crediticia va de 1 (normal) a 5 (irrecuperable):
 *   1        → normal
 *   2        → riesgo bajo / seguimiento especial
 *   3, 4, 5  → riesgo alto / irrecuperable
 *
 * Criterio Vertix (según la operatoria informada):
 *   - Situación 1 sin cheques rechazados   → se ofrece descuento (permitir).
 *   - Situación 1/2 o con cheques impagos   → se analiza (advertir).
 *   - Situación 3 o superior               → no se descuenta (bloquear, no emitir presupuesto).
 *
 * Si la API no responde, se hace "fail-open": se permite continuar pero se
 * informa que no se pudo verificar (para no frenar a un cliente legítimo por
 * una caída del servicio del BCRA).
 */

import { logger } from "./logger";
import { normalizarCuit } from "./cuit";
import type { BcraInfo } from "@/types";

const BASE = "https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas";
const TIMEOUT_MS = 8000;

export type BcraResultado = {
  disponible: boolean;
  cuit: string;
  denominacion?: string;
  situacionMaxima: number | null;
  tieneChequesRechazados: boolean;
  chequesRechazadosImpagos: boolean;
};

export type BcraDecision = {
  decision: "permitir" | "advertir" | "bloquear";
  motivo: string;
};

export function bcraHabilitado(): boolean {
  // Activo por defecto (API pública). Se puede desactivar con BCRA_CHECK_ENABLED=false.
  return process.env.BCRA_CHECK_ENABLED !== "false";
}

async function getJson(url: string): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    logger.warn("bcra", "Error consultando BCRA", {
      url,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type DeudasBody = {
  results?: {
    denominacion?: string;
    periodos?: Array<{ entidades?: Array<{ situacion?: number }> }>;
  };
};

type ChequesBody = {
  results?: {
    causales?: Array<{
      entidades?: Array<{
        detalle?: Array<{ montoNoPagado?: number; fechaPago?: string | null }>;
      }>;
    }>;
  };
};

export async function consultarBcra(cuitInput: string): Promise<BcraResultado> {
  const cuit = normalizarCuit(cuitInput);
  const base: BcraResultado = {
    disponible: false,
    cuit,
    situacionMaxima: null,
    tieneChequesRechazados: false,
    chequesRechazadosImpagos: false,
  };

  if (!bcraHabilitado() || cuit.length !== 11) return base;

  const [deudas, cheques] = await Promise.all([
    getJson(`${BASE}/${cuit}`),
    getJson(`${BASE}/ChequesRechazados/${cuit}`),
  ]);

  // Si ninguna respondió, no está disponible (fail-open aguas arriba).
  if (!deudas && !cheques) return base;

  base.disponible = true;

  // --- Deudas / situación ---
  if (deudas) {
    if (deudas.status === 200) {
      const body = deudas.body as DeudasBody;
      base.denominacion = body.results?.denominacion;
      const periodos = body.results?.periodos ?? [];
      let max: number | null = null;
      for (const p of periodos) {
        for (const e of p.entidades ?? []) {
          if (typeof e.situacion === "number") {
            max = max === null ? e.situacion : Math.max(max, e.situacion);
          }
        }
      }
      base.situacionMaxima = max ?? 1; // registrado sin deudas = situación normal
    } else if (deudas.status === 404) {
      base.situacionMaxima = 1; // sin registros de deuda = normal
    }
  }

  // --- Cheques rechazados ---
  if (cheques) {
    if (cheques.status === 200) {
      base.tieneChequesRechazados = true;
      const body = cheques.body as ChequesBody;
      const causales = body.results?.causales ?? [];
      for (const c of causales) {
        for (const e of c.entidades ?? []) {
          for (const d of e.detalle ?? []) {
            // Impago = sin fecha de pago o con monto pendiente.
            if (!d.fechaPago || (d.montoNoPagado ?? 0) > 0) {
              base.chequesRechazadosImpagos = true;
            }
          }
        }
      }
      // Si no pudimos discriminar el detalle, asumimos impago por precaución.
      if (!base.chequesRechazadosImpagos && causales.length > 0) {
        base.chequesRechazadosImpagos = true;
      }
    }
    // 404 = sin cheques rechazados → queda en false.
  }

  return base;
}

export function evaluarBcra(r: BcraResultado, etiqueta = "El librador"): BcraDecision {
  if (!r.disponible) {
    return {
      decision: "permitir",
      motivo: "No se pudo verificar la situación en el BCRA en este momento.",
    };
  }

  const sit = r.situacionMaxima ?? 1;

  if (sit >= 3) {
    return {
      decision: "bloquear",
      motivo: `${etiqueta} registra situación ${sit} en el BCRA. No es posible emitir el presupuesto.`,
    };
  }

  if (sit === 2 && r.chequesRechazadosImpagos) {
    return {
      decision: "advertir",
      motivo: `${etiqueta} registra situación 2 y cheques rechazados impagos en el BCRA. Requiere análisis previo.`,
    };
  }

  if (sit === 2) {
    return {
      decision: "advertir",
      motivo: `${etiqueta} registra situación 2 en el BCRA. Requiere análisis previo.`,
    };
  }

  if (r.chequesRechazadosImpagos) {
    return {
      decision: "advertir",
      motivo: `${etiqueta} registra cheques rechazados impagos en el BCRA. Requiere análisis previo.`,
    };
  }

  return { decision: "permitir", motivo: "Sin observaciones en el BCRA." };
}

/** Resumen para mostrar al usuario (siempre, esté limpio o no). */
export function infoBcra(r: BcraResultado, etiqueta: string): BcraInfo {
  const ev = evaluarBcra(r, etiqueta);
  const estado: BcraInfo["estado"] = !r.disponible
    ? "no_verificado"
    : ev.decision === "bloquear"
      ? "riesgo"
      : ev.decision === "advertir"
        ? "analisis"
        : "ok";
  return {
    cuit: r.cuit,
    situacion: r.disponible ? r.situacionMaxima : null,
    cheques_rechazados: r.chequesRechazadosImpagos,
    estado,
    mensaje: ev.motivo,
  };
}
