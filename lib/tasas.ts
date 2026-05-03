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

const FALLBACK_TASAS: Tasas = {
  cheques: 0.15,
  prestamos_ph: 0.08,
  prestamos_pj: 0.1,
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

async function fetchTasasFromSheet(): Promise<Tasas> {
  const sheetId = envOrThrow("GOOGLE_SHEETS_ID");
  const auth = buildAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: SHEET_RANGE,
  });

  const rows = res.data.values ?? [];
  if (rows.length === 0) {
    throw new Error('La hoja "tasas" está vacía');
  }

  // Detectar header (servicio | tasa | actualizado_el)
  const [first, ...rest] = rows;
  const looksLikeHeader = (first ?? []).some(
    (v) => typeof v === "string" && v.toLowerCase().includes("servicio")
  );
  const dataRows = looksLikeHeader ? rest : rows;

  const map = new Map<TasaServicio, number>();
  let actualizado_el = "";

  for (const row of dataRows) {
    const [servicioRaw, tasaRaw, fechaRaw] = row;
    if (!servicioRaw || tasaRaw == null) continue;
    const servicio = String(servicioRaw).trim().toLowerCase() as TasaServicio;
    if (!["cheques", "prestamos_ph", "prestamos_pj"].includes(servicio)) continue;
    const tasa = Number(String(tasaRaw).replace(",", "."));
    if (!Number.isFinite(tasa) || tasa <= 0) continue;
    map.set(servicio, tasa);
    if (fechaRaw && !actualizado_el) actualizado_el = String(fechaRaw);
  }

  const cheques = map.get("cheques");
  const prestamos_ph = map.get("prestamos_ph");
  const prestamos_pj = map.get("prestamos_pj");

  if (cheques == null || prestamos_ph == null || prestamos_pj == null) {
    throw new Error(
      "La hoja de tasas no contiene los 3 servicios requeridos (cheques, prestamos_ph, prestamos_pj)"
    );
  }

  return {
    cheques,
    prestamos_ph,
    prestamos_pj,
    actualizado_el: actualizado_el || new Date().toISOString().slice(0, 10),
  };
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
    case "cheques":
      return tasas.cheques;
    case "prestamos_ph":
      return tasas.prestamos_ph;
    case "prestamos_pj":
      return tasas.prestamos_pj;
  }
}

export function clearTasasCache() {
  cache = null;
}
