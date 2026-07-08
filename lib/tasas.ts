import { google } from "googleapis";
import { logger } from "./logger";
import type { Tasas, TasaServicio } from "@/types";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const SHEET_RANGE = "tasas!A1:C100";

type CacheEntry = {
  value: Tasas;
  expiresAt: number;
};

let cache: CacheEntry | null = null;
let inflight: Promise<Tasas> | null = null;

// Valores expresados como TNA (Tasa Nominal Anual) en %. La hoja "tasas" de
// Google Sheets debe contener estos valores anuales (ej.: cheques_directo = 48).
// La tasa total de cheques que ve el cliente = tasa de descuento + arancel.
const FALLBACK_TASAS: Tasas = {
  cheques_directo: 48,
  cheques_comitente: 35,
  arancel_cheques: 2.5,
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

  // Servicios reconocidos. "cheques" se acepta como alias y aplica a ambas
  // modalidades (directo y comitente) cuando no se cargan por separado.
  // "arancel_cheques" es el arancel fijo de la empresa (se suma a la tasa) y
  // tiene su propio rango plausible (0–50) porque es mucho menor que una TNA.
  const RECONOCIDOS = [
    "cheques",
    "cheques_directo",
    "cheques_comitente",
    "arancel_cheques",
    "prestamos_ph",
    "prestamos_pj",
  ];
  const ARANCEL_MIN = 0;
  const ARANCEL_MAX = 50;

  const map = new Map<string, number>();
  let actualizado_el = "";

  for (const row of dataRows) {
    const [servicioRaw, tasaRaw, fechaRaw] = row;
    if (!servicioRaw || tasaRaw == null) continue;
    const servicio = String(servicioRaw).trim().toLowerCase();
    if (!RECONOCIDOS.includes(servicio)) continue;
    const tasa = Number(String(tasaRaw).replace(",", "."));
    if (!Number.isFinite(tasa)) continue;
    const [min, max] =
      servicio === "arancel_cheques" ? [ARANCEL_MIN, ARANCEL_MAX] : [TASA_MIN, TASA_MAX];
    if (tasa < min || tasa > max) {
      logger.warn("tasas", `Tasa fuera de rango para "${servicio}" — ignorada`, {
        tasa,
        rango: `${min}-${max}`,
      });
      continue;
    }
    map.set(servicio, tasa);
    if (fechaRaw && !actualizado_el) actualizado_el = String(fechaRaw);
  }

  const chequesAlias = map.get("cheques");
  const cheques_directo = map.get("cheques_directo") ?? chequesAlias;
  const cheques_comitente = map.get("cheques_comitente") ?? chequesAlias;
  // El arancel es opcional en la hoja: si no está, se usa el valor vigente.
  const arancel_cheques = map.get("arancel_cheques") ?? FALLBACK_TASAS.arancel_cheques;
  const prestamos_ph = map.get("prestamos_ph");
  const prestamos_pj = map.get("prestamos_pj");

  if (
    cheques_directo == null ||
    cheques_comitente == null ||
    prestamos_ph == null ||
    prestamos_pj == null
  ) {
    throw new Error(
      "La hoja de tasas no contiene todos los servicios requeridos (cheques_directo/cheques_comitente o cheques, prestamos_ph, prestamos_pj)"
    );
  }

  return {
    cheques_directo,
    cheques_comitente,
    arancel_cheques,
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

export function getTasaForServicio(
  tasas: Tasas,
  servicio: TasaServicio
): number {
  switch (servicio) {
    case "cheques_directo":
      return tasas.cheques_directo;
    case "cheques_comitente":
      return tasas.cheques_comitente;
    case "prestamos_ph":
      return tasas.prestamos_ph;
    case "prestamos_pj":
      return tasas.prestamos_pj;
  }
}

export function clearTasasCache() {
  cache = null;
}
