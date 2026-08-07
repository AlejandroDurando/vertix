import { google } from "googleapis";
import { logger } from "./logger";
import type { InstrumentoCheque, ModalidadCheque, Tasas, TramoTasa } from "@/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const SHEET_RANGE = "tasas!A1:C100";

type CacheEntry = {
  value: Tasas;
  expiresAt: number;
};

let cache: CacheEntry | null = null;
let inflight: Promise<Tasas> | null = null;

// Valores expresados como TNA (Tasa Nominal Anual) en %. La hoja "tasas" de
// Google Sheets contiene una fila por tramo (ver CLAVES abajo). Esto es sólo el
// respaldo por si la hoja no responde.
const FALLBACK_TASAS: Tasas = {
  cheques: {
    directo: [
      { hastaDias: 45, tasa: 48, gastos: 2 },
      { hastaDias: null, tasa: 72, gastos: 3.5 },
    ],
    comitente: [
      { hastaDias: 30, tasa: 40, gastos: 2.5 },
      { hastaDias: 60, tasa: 43, gastos: 2.5 },
      { hastaDias: null, tasa: 45, gastos: 2.5 },
    ],
    // La FCE cotiza 40% todo incluido: no lleva arancel (confirmado el 06/08/2026).
    comitenteFce: { hastaDias: null, tasa: 40, gastos: 0 },
  },
  prestamos_ph: 72,
  prestamos_pj: 82,
  actualizado_el: "fallback",
};

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Variable de entorno ${name} no configurada`);
  }
  return v;
}

function buildAuth() {
  const email = envOrThrow("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const rawKey = envOrThrow("GOOGLE_SERVICE_ACCOUNT_KEY");
  // Las private keys suelen venir con \n escapados al guardarse en .env
  const privateKey = rawKey.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

// Rango plausible para una TNA en %. Valores fuera de esto casi seguro son un
// error de carga (ej. el formato viejo en fracción: cheques=0.15) y se ignoran
// para no emitir presupuestos absurdos.
const TASA_MIN = 5;
const TASA_MAX = 300;

// Filas que se leen de la hoja. Cada tramo son dos filas: la tasa de descuento
// y los gastos de Vertix, para que los dueños ajusten una sin tocar la otra.
const CLAVES = {
  directo: [
    { hastaDias: 45 as number | null, tasa: "directo_hasta_45", gastos: "gastos_directo_hasta_45" },
    { hastaDias: null as number | null, tasa: "directo_desde_46", gastos: "gastos_directo_desde_46" },
  ],
  comitente: [
    { hastaDias: 30 as number | null, tasa: "comitente_hasta_30", gastos: "arancel_comitente" },
    { hastaDias: 60 as number | null, tasa: "comitente_31_60", gastos: "arancel_comitente" },
    { hastaDias: null as number | null, tasa: "comitente_desde_61", gastos: "arancel_comitente" },
  ],
  // La FCE tiene su propia fila de gastos y hoy va en 0 (el 40% es total). Es
  // opcional en la hoja: si no está, se toma 0 en vez de invalidar la lectura.
  comitenteFce: {
    hastaDias: null as number | null,
    tasa: "comitente_fce",
    gastos: "gastos_comitente_fce",
    gastosPorDefecto: 0,
  },
};

// Los gastos son mucho menores que una TNA, así que tienen su propio rango.
const GASTOS_MIN = 0;
const GASTOS_MAX = 50;
const esGastos = (clave: string) => clave.startsWith("gastos_") || clave.startsWith("arancel_");

/** Parsea las filas de la hoja "tasas". Exportada para poder testearla. */
export function parseTasasRows(rows: unknown[][]): Tasas {
  if (rows.length === 0) {
    throw new Error('La hoja "tasas" está vacía');
  }

  // Detectar header (servicio | tasa | actualizado_el)
  const [first, ...rest] = rows;
  const looksLikeHeader = (first ?? []).some(
    (v) => typeof v === "string" && v.toLowerCase().includes("servicio")
  );
  const dataRows = looksLikeHeader ? rest : rows;

  const map = new Map<string, number>();
  let actualizado_el = "";

  for (const row of dataRows) {
    const [servicioRaw, tasaRaw, fechaRaw] = row;
    if (!servicioRaw || tasaRaw == null) continue;
    const clave = String(servicioRaw).trim().toLowerCase();
    const valor = Number(String(tasaRaw).replace(",", "."));
    if (!Number.isFinite(valor)) continue;
    const [min, max] = esGastos(clave) ? [GASTOS_MIN, GASTOS_MAX] : [TASA_MIN, TASA_MAX];
    if (valor < min || valor > max) {
      logger.warn("tasas", `Valor fuera de rango para "${clave}" — ignorado`, {
        valor,
        rango: `${min}-${max}`,
      });
      continue;
    }
    map.set(clave, valor);
    if (fechaRaw && !actualizado_el) actualizado_el = String(fechaRaw);
  }

  const faltantes: string[] = [];
  const leer = (clave: string): number => {
    const v = map.get(clave);
    if (v == null) faltantes.push(clave);
    return v ?? 0;
  };

  const tramo = (def: {
    hastaDias: number | null;
    tasa: string;
    gastos: string;
    gastosPorDefecto?: number;
  }): TramoTasa => ({
    hastaDias: def.hastaDias,
    tasa: leer(def.tasa),
    gastos:
      def.gastosPorDefecto == null
        ? leer(def.gastos)
        : map.get(def.gastos) ?? def.gastosPorDefecto,
  });

  const cheques = {
    directo: CLAVES.directo.map(tramo),
    comitente: CLAVES.comitente.map(tramo),
    comitenteFce: tramo(CLAVES.comitenteFce),
  };
  const prestamos_ph = leer("prestamos_ph");
  const prestamos_pj = leer("prestamos_pj");

  if (faltantes.length > 0) {
    throw new Error(
      `La hoja de tasas no tiene estas filas: ${[...new Set(faltantes)].join(", ")}`
    );
  }

  return {
    cheques,
    prestamos_ph,
    prestamos_pj,
    actualizado_el: actualizado_el || new Date().toISOString().slice(0, 10),
  };
}

async function fetchTasasFromSheet(): Promise<Tasas> {
  const sheetId = envOrThrow("GOOGLE_SHEETS_ID");
  const auth = buildAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
  });

  return parseTasasRows(res.data.values ?? []);
}

export async function getTasas(opts?: { forceRefresh?: boolean }): Promise<Tasas> {
  const now = Date.now();

  if (!opts?.forceRefresh && cache && cache.expiresAt > now) {
    return cache.value;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const value = await fetchTasasFromSheet();
      cache = { value, expiresAt: now + CACHE_TTL_MS };
      logger.info("tasas", "Tasas actualizadas desde Google Sheets", {
        actualizado_el: value.actualizado_el,
      });
      return value;
    } catch (err) {
      logger.error("tasas", "No se pudieron obtener las tasas, usando fallback", {
        err: err instanceof Error ? err.message : String(err),
      });
      // Si tenemos un cache vencido, lo usamos antes que el fallback hardcoded
      if (cache) return cache.value;
      return FALLBACK_TASAS;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Elige el tramo de tasa que corresponde a una operación.
 *
 * El plazo se mide en días hasta la acreditación del comprador, que es el
 * mismo número que se usa para calcular el descuento (confirmado por el
 * cliente con un ejemplo: cheque comprado el 30/07 con vencimiento el 10/08 se
 * acredita el 12/08, son 13 días).
 */
export function tramoParaOperacion(
  tasas: Tasas,
  opts: { modalidad: ModalidadCheque; instrumento: InstrumentoCheque; dias: number }
): TramoTasa {
  if (opts.modalidad === "comitente") {
    // La FCE no tiene tramos: su tasa depende del pagador de la factura, así
    // que se cotiza con una estimación única.
    if (opts.instrumento === "fce") return tasas.cheques.comitenteFce;
    return elegirTramo(tasas.cheques.comitente, opts.dias);
  }
  return elegirTramo(tasas.cheques.directo, opts.dias);
}

function elegirTramo(tramos: TramoTasa[], dias: number): TramoTasa {
  for (const t of tramos) {
    if (t.hastaDias === null || dias <= t.hastaDias) return t;
  }
  return tramos[tramos.length - 1];
}

/** Texto del tramo aplicado, para mostrarlo junto al resultado. */
export function describirTramo(tramo: TramoTasa, tramos: TramoTasa[]): string {
  const i = tramos.indexOf(tramo);
  const desde = i > 0 ? (tramos[i - 1].hastaDias ?? 0) + 1 : 1;
  if (tramo.hastaDias === null) {
    return i <= 0 ? "todos los plazos" : `${desde} días o más`;
  }
  return i <= 0 ? `hasta ${tramo.hastaDias} días` : `de ${desde} a ${tramo.hastaDias} días`;
}

export function clearTasasCache() {
  cache = null;
}
