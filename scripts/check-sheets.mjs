#!/usr/bin/env node
// Verificación rápida de la conexión con Google Sheets.
// Uso: npm run check:sheets

import { google } from "googleapis";

const required = [
  "GOOGLE_SHEETS_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
];

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function fail(msg, hint) {
  console.log(c.red("✗ ") + msg);
  if (hint) console.log(c.dim("  → " + hint));
  process.exit(1);
}

function ok(msg) {
  console.log(c.green("✓ ") + msg);
}

const missing = required.filter((k) => !process.env[k] || !process.env[k].trim());
if (missing.length > 0) {
  fail(
    `Variables de entorno faltantes: ${missing.join(", ")}`,
    "Asegurate de tener un .env.local con estas variables y ejecutá con `npm run check:sheets`"
  );
}
ok("Variables de entorno presentes");

const sheetId = process.env.GOOGLE_SHEETS_ID.trim();
const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL.trim();
const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n");

if (!key.includes("BEGIN PRIVATE KEY")) {
  fail(
    "GOOGLE_SERVICE_ACCOUNT_KEY no parece una private key válida",
    "Debe contener '-----BEGIN PRIVATE KEY-----'. Copialo del JSON del service account, campo `private_key`."
  );
}
ok("Private key tiene formato válido");

const auth = new google.auth.JWT({
  email,
  key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

console.log(c.dim(`  Spreadsheet: ${sheetId}`));
console.log(c.dim(`  Service account: ${email}`));
console.log("");

const sheets = google.sheets({ version: "v4", auth });

let res;
try {
  res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "tasas!A1:C100",
  });
} catch (err) {
  const msg = err?.message ?? String(err);
  if (msg.includes("PERMISSION_DENIED") || msg.includes("does not have permission")) {
    fail(
      "Permiso denegado al leer la spreadsheet",
      `Compartí la hoja con ${email} (rol Lector basta)`
    );
  }
  if (msg.includes("Unable to parse range") || msg.includes("Requested entity was not found")) {
    fail(
      'No se encontró la hoja "tasas" o el rango es inválido',
      'La primera pestaña debe llamarse "tasas"'
    );
  }
  if (msg.includes("invalid_grant")) {
    fail(
      "Credenciales inválidas (invalid_grant)",
      "La private key está mal copiada o el email no coincide. Revisá ambos en el JSON original."
    );
  }
  fail("Error consultando Sheets API", msg);
}

ok("Conexión con Sheets API exitosa");

const rows = res.data.values ?? [];
if (rows.length === 0) {
  fail(
    'La hoja "tasas" está vacía',
    "Agregá una fila por tramo (ver .env.example): directo_hasta_45, directo_desde_46, comitente_hasta_30, etc."
  );
}

const [first, ...rest] = rows;
const looksLikeHeader = (first ?? []).some(
  (v) => typeof v === "string" && v.toLowerCase().includes("servicio")
);
const dataRows = looksLikeHeader ? rest : rows;

const map = new Map();
let updated = "";
for (const row of dataRows) {
  const [s, t, f] = row;
  if (!s || t == null) continue;
  const servicio = String(s).trim().toLowerCase();
  const tasa = Number(String(t).replace(",", "."));
  if (!Number.isFinite(tasa)) continue;
  map.set(servicio, tasa);
  if (f && !updated) updated = String(f);
}

// Una fila por tramo: la tasa de descuento y los gastos van separados para que
// se pueda ajustar una sin tocar la otra.
const REQUERIDAS = [
  "directo_hasta_45", "gastos_directo_hasta_45",
  "directo_desde_46", "gastos_directo_desde_46",
  "comitente_hasta_30", "comitente_31_60", "comitente_desde_61",
  "comitente_fce", "arancel_comitente",
  "prestamos_ph", "prestamos_pj",
];

const missingRows = REQUERIDAS.filter((k) => !map.has(k));
if (missingRows.length > 0) {
  fail(
    `Faltan filas en la hoja: ${missingRows.join(", ")}`,
    "La hoja debe tener una fila por tramo, con la TNA anual en %"
  );
}

ok("Filas de servicio presentes");

const v = (k) => map.get(k);
const total = (t, g) => `${Number((v(t) + v(g)).toFixed(2))}% total`;
console.log("");
console.log(c.bold("Descuento de cheques - directo con Vertix:"));
console.log(c.dim("  hasta 45 dias      -> ") + c.yellow(`${v("directo_hasta_45")}%`) + c.dim(` + ${v("gastos_directo_hasta_45")}% gastos = ${total("directo_hasta_45", "gastos_directo_hasta_45")}`));
console.log(c.dim("  46 dias o mas      -> ") + c.yellow(`${v("directo_desde_46")}%`) + c.dim(` + ${v("gastos_directo_desde_46")}% gastos = ${total("directo_desde_46", "gastos_directo_desde_46")}`));
console.log("");
console.log(c.bold("Descuento de cheques - cuenta comitente:"));
for (const [etiqueta, clave] of [["hasta 30 dias", "comitente_hasta_30"], ["de 31 a 60 dias", "comitente_31_60"], ["61 dias o mas", "comitente_desde_61"]]) {
  console.log(c.dim(`  ${etiqueta.padEnd(18)} -> `) + c.yellow(`${v(clave)}%`) + c.dim(` + ${v("arancel_comitente")}% arancel = ${total(clave, "arancel_comitente")}`));
}
// La FCE tiene su propia fila de gastos (hoy en 0: el 40% es total). Si la fila
// no esta cargada, se asume 0, igual que en lib/tasas.ts.
const gastosFce = map.get("gastos_comitente_fce") ?? 0;
console.log(c.dim(`  ${"FCE (estimado)".padEnd(18)} -> `) + c.yellow(`${v("comitente_fce")}%`) + c.dim(` + ${gastosFce}% gastos = ${Number((v("comitente_fce") + gastosFce).toFixed(2))}% total`));
console.log("");
// Costos que se le cobran al vendedor ademas de la tasa. Filas opcionales: si
// faltan, lib/tasas.ts usa estos mismos valores por defecto.
console.log(c.bold("Costos del vendedor (filas opcionales):"));
for (const [etiqueta, clave, def] of [
  ["IVA", "iva", 21],
  ["derechos de mercado", "derechos_mercado", 0.06],
  ["impuesto al cheque", "impuesto_cheque", 1.2],
]) {
  const valor = map.get(clave);
  console.log(
    c.dim(`  ${etiqueta.padEnd(18)} -> `) +
      c.yellow(`${valor ?? def}%`) +
      c.dim(valor == null ? " (por defecto, falta la fila)" : "")
  );
}
console.log("");
console.log(c.bold("Prestamos (rango):"));
console.log(c.dim("  prestamos_ph       -> ") + c.yellow(`${v("prestamos_ph")}%`));
console.log(c.dim("  prestamos_pj       -> ") + c.yellow(`${v("prestamos_pj")}%`));
if (updated) console.log(c.dim("  actualizado_el     -> ") + updated);
console.log("");
console.log(c.green(c.bold("Todo OK. ")) + "El simulador va a usar estas tasas.");
