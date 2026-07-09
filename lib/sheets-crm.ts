import { google } from "googleapis";
import { logger } from "./logger";
import type { AltaInput, ContactoInput, PrecalificacionInput } from "./validations";

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
  sentAt: string,
  meta?: { adjuntos?: string[]; bcra?: string }
): Promise<AppendResult> {
  const adjuntos = (meta?.adjuntos ?? []).join(", ");
  const bcra = meta?.bcra ?? "";
  const base = [sentAt, data.servicio, data.nombre, data.email, data.telefono];

  // Columnas F..P según servicio (ver encabezados en la hoja). fecha_pago (H)
  // y plazo_meses (I) van en columnas separadas: si comparten columna, Sheets
  // le aplica formato de fecha al plazo y lo muestra como una fecha de 1900.
  if (data.servicio === "cheques") {
    return appendRow("Precalificacion", [
      ...base,
      data.empresa, // F
      data.monto_cheque, // G
      data.fecha_pago, // H
      "", // I plazo_meses
      data.banco_emisor, // J
      data.cuit_librador, // K
      data.cuit_endosatario, // L
      "", // M tipo_prestamo
      "", // N tipo_ingreso
      bcra, // O
      adjuntos, // P
    ]);
  }

  return appendRow("Precalificacion", [
    ...base,
    data.tipo_persona, // F
    data.monto_solicitado, // G
    "", // H fecha_pago
    data.plazo_meses, // I
    "", // J banco
    data.cuit_solicitante, // K
    "", // L cuit_endosatario
    data.tipo_prestamo, // M
    data.tipo_ingreso, // N
    bcra, // O
    adjuntos, // P
  ]);
}

export async function appendAlta(
  data: AltaInput,
  sentAt: string,
  adjuntos: string[]
): Promise<AppendResult> {
  const docs = adjuntos.join(", ");

  if (data.tipo === "fisica") {
    return appendRow("AltasPF", [
      sentAt,
      data.alyc,
      data.nombre,
      data.apellido,
      data.cuit,
      data.dni,
      data.fecha_nacimiento,
      data.estado_civil,
      `${data.nacimiento_provincia} / ${data.nacimiento_localidad}`,
      data.domicilio,
      data.localidad,
      data.provincia,
      data.codigo_postal,
      data.profesion,
      data.es_autonomo,
      data.cbu,
      data.email,
      data.email_alternativo,
      data.telefono,
      data.es_pep,
      data.domicilio_dni_actual ?? "",
      data.conyuge_nombre ?? "",
      data.conyuge_dni ?? "",
      docs,
    ]);
  }

  return appendRow("AltasPJ", [
    sentAt,
    data.alyc,
    data.razon_social,
    data.cuit,
    data.tipo_societario,
    data.fecha_constitucion,
    data.domicilio_legal,
    data.localidad,
    data.provincia,
    data.codigo_postal,
    data.actividad,
    data.cbu,
    data.email,
    data.email_alternativo,
    data.telefono,
    data.es_pep,
    data.referente_nombre,
    data.referente_cargo,
    data.referente_cuit,
    data.referente_dni,
    data.referente_estado_civil,
    data.referente_telefono,
    data.referente_email,
    data.datos_socios,
    data.conyuge_nombre ?? "",
    data.conyuge_dni ?? "",
    docs,
  ]);
}
