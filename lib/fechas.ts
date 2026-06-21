/**
 * Utilidades de fechas y días hábiles (Argentina).
 *
 * Se usan para:
 *  - Calcular los días entre hoy y la fecha de pago de un cheque (descuento).
 *  - Estimar la fecha real de acreditación (2/3 días hábiles después).
 *  - Bloquear operaciones cuyo vencimiento sea menor a 5 días hábiles.
 *
 * Los feriados son aproximados y deben mantenerse actualizados año a año.
 * Los días no listados igualmente se aproximan por fin de semana.
 */

// Feriados nacionales inamovibles + trasladables conocidos (formato YYYY-MM-DD).
// Mantener actualizado. Si falta alguno, el cálculo sigue siendo válido salvo
// por ese día puntual (se informa que la cotización es estimada).
const FERIADOS_AR = new Set<string>([
  // 2026
  "2026-01-01", // Año Nuevo
  "2026-02-16", // Carnaval
  "2026-02-17", // Carnaval
  "2026-03-24", // Día de la Memoria
  "2026-04-02", // Malvinas
  "2026-04-03", // Viernes Santo
  "2026-05-01", // Día del Trabajador
  "2026-05-25", // Revolución de Mayo
  "2026-06-15", // Güemes (trasladado)
  "2026-06-20", // Belgrano
  "2026-07-09", // Independencia
  "2026-08-17", // San Martín
  "2026-10-12", // Diversidad Cultural
  "2026-11-23", // Soberanía (trasladado)
  "2026-12-08", // Inmaculada Concepción
  "2026-12-25", // Navidad
  // 2027 (parcial, principales fijos)
  "2027-01-01",
  "2027-03-24",
  "2027-04-02",
  "2027-05-01",
  "2027-05-25",
  "2027-06-20",
  "2027-07-09",
  "2027-08-17",
  "2027-12-08",
  "2027-12-25",
]);

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Devuelve la fecha en formato YYYY-MM-DD (en horario local). */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parsea un YYYY-MM-DD como fecha local a medianoche (evita corrimientos por UTC). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function esFinDeSemana(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export function esFeriado(d: Date): boolean {
  return FERIADOS_AR.has(toISODate(d));
}

export function esDiaHabil(d: Date): boolean {
  return !esFinDeSemana(d) && !esFeriado(d);
}

/** Suma n días hábiles a una fecha (n >= 0). */
export function sumarDiasHabiles(desde: Date, n: number): Date {
  const out = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  let restantes = n;
  while (restantes > 0) {
    out.setDate(out.getDate() + 1);
    if (esDiaHabil(out)) restantes--;
  }
  return out;
}

/** Días hábiles entre dos fechas (excluye la fecha de inicio, incluye la final). */
export function diasHabilesEntre(desde: Date, hasta: Date): number {
  if (hasta <= desde) return 0;
  let count = 0;
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const fin = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate());
  while (cursor < fin) {
    cursor.setDate(cursor.getDate() + 1);
    if (esDiaHabil(cursor)) count++;
  }
  return count;
}

/** Días calendario entre dos fechas (redondeo hacia abajo). */
export function diasCalendarioEntre(desde: Date, hasta: Date): number {
  const a = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate()).getTime();
  const b = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate()).getTime();
  return Math.round((b - a) / MS_POR_DIA);
}

export function hoy(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
