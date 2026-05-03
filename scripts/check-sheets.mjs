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
  fail('La hoja "tasas" está vacía', "Agregá las filas: cheques / prestamos_ph / prestamos_pj");
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

const expected = ["cheques", "prestamos_ph", "prestamos_pj"];
const missingRows = expected.filter((s) => !map.has(s));
if (missingRows.length > 0) {
  fail(
    `Faltan filas en la hoja: ${missingRows.join(", ")}`,
    "La hoja debe tener una fila por cada uno de los 3 servicios"
  );
}

ok("Las 3 filas de servicio están presentes");
console.log("");
console.log(c.bold("Tasas leídas:"));
console.log(c.dim("  cheques        → ") + c.yellow(`${map.get("cheques")}% diario`));
console.log(c.dim("  prestamos_ph   → ") + c.yellow(`${(map.get("prestamos_ph") * 100).toFixed(2)}% mensual`));
console.log(c.dim("  prestamos_pj   → ") + c.yellow(`${(map.get("prestamos_pj") * 100).toFixed(2)}% mensual`));
if (updated) console.log(c.dim("  actualizado_el → ") + updated);
console.log("");
console.log(c.green(c.bold("Todo OK. ")) + "El simulador va a usar estas tasas.");
