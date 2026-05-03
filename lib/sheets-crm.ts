import { google } from "googleapis";
import { logger } from "./logger";
import type { ContactoInput } from "./validations";
import type { PrecalificacionInput } from "./validations";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_CRM_ID ?? process.env.GOOGLE_SHEETS_ID ?? "";

function buildAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !rawKey) return null;
  return new google.auth.JWT({
    email,
    key: rawKey.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

type AppendResult =
  | { ok: true }
  | { ok: false; reason: "disabled" | "error"; message?: string };

async function appendRow(tab: string, values: (string | number)[]): Promise<AppendResult> {
  if (!SPREADSHEET_ID) {
    logger.info("sheets-crm", "GOOGLE_SHEETS_CRM_ID no configurado — skip");
    return { ok: false, reason: "disabled" };
  }
  const auth = buildAuth();
  if (!auth) {
    logger.warn("sheets-crm", "Credenciales de Google no configuradas — skip");
    return { ok: false, reason: "disabled" };
  }
  try {
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tab}!A:Z`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("sheets-crm", `Error escribiendo en tab "${tab}"`, { err: msg });
    return { ok: false, reason: "error", message: msg };
  }
}

export async function appendContacto(
  data: ContactoInput,
  sentAt: string
): Promise<AppendResult> {
  return appendRow("Contacto", [
    sentAt,
    data.nombre,
    data.email,
    data.telefono,
    data.empresa ?? "",
    data.asunto,
    data.mensaje,
    "web",
  ]);
}

export async function appendPrecalificacion(
  data: PrecalificacionInput,
  sentAt: string
): Promise<AppendResult> {
  const base = [
    sentAt,
    data.servicio,
    data.nombre,
    data.email,
    data.telefono,
  ];

  if (data.servicio === "cheques") {
    return appendRow("Precalificacion", [
      ...base,
      data.empresa,
      data.monto_cheque,
      "",
      data.fecha_vencimiento,
      data.banco_emisor,
      data.tipo_cheque,
      "",
      "",
    ]);
  }

  return appendRow("Precalificacion", [
    ...base,
    "",
    data.monto_solicitado,
    data.plazo_meses,
    "",
    "",
    "",
    data.tipo_persona,
    data.tipo_ingreso,
  ]);
}
