import { Resend } from "resend";
import { logger } from "./logger";

let _resend: Resend | null = null;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || !key.trim()) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

const FROM = process.env.EMAIL_FROM ?? "Vertix <notificaciones@vertix.com.ar>";
const TO   = process.env.EMAIL_TO   ?? "info@vertix.com.ar";

export type EmailResult =
  | { ok: true }
  | { ok: false; reason: "disabled" | "error"; message?: string };

export type EmailAttachment = { filename: string; content: string }; // content = base64

// Tope total de adjuntos (en base64). Por encima, se omiten y se avisa en el cuerpo.
const MAX_ATTACHMENTS_B64 = 18 * 1024 * 1024;

function withinAttachmentLimit(attachments: EmailAttachment[]): boolean {
  const total = attachments.reduce((acc, a) => acc + a.content.length, 0);
  return total <= MAX_ATTACHMENTS_B64;
}

async function send(
  subject: string,
  html: string,
  attachments?: EmailAttachment[]
): Promise<EmailResult> {
  const resend = getResend();
  if (!resend) {
    logger.info("email", "RESEND_API_KEY no configurada — skip");
    return { ok: false, reason: "disabled" };
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: TO,
      subject,
      html,
      ...(attachments && attachments.length ? { attachments } : {}),
    });
    if (error) {
      logger.error("email", "Error enviando email", { error });
      return { ok: false, reason: "error", message: error.message };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("email", "Excepción al enviar email", { err: msg });
    return { ok: false, reason: "error", message: msg };
  }
}

export async function emailContacto(data: {
  nombre: string;
  email: string;
  telefono: string;
  empresa?: string;
  asunto: string;
  mensaje: string;
}): Promise<EmailResult> {
  const subject = `[Vertix] Nueva consulta: ${data.asunto}`;
  const html = `
    <h2 style="color:#1B2A4E">Nueva consulta de contacto</h2>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif">
      <tr><td style="padding:8px;color:#666;width:140px">Nombre</td><td style="padding:8px;font-weight:600">${data.nombre}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px"><a href="mailto:${data.email}">${data.email}</a></td></tr>
      <tr><td style="padding:8px;color:#666">Teléfono</td><td style="padding:8px">${data.telefono}</td></tr>
      ${data.empresa ? `<tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Empresa</td><td style="padding:8px">${data.empresa}</td></tr>` : ""}
      <tr><td style="padding:8px;color:#666">Asunto</td><td style="padding:8px">${data.asunto}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:8px;color:#666;vertical-align:top">Mensaje</td><td style="padding:8px;white-space:pre-wrap">${data.mensaje}</td></tr>
    </table>
  `;
  return send(subject, html);
}

function esc(v: unknown): string {
  return String(v ?? "—").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tablaRows(data: Record<string, unknown>, omit: string[] = []): string {
  return Object.entries(data)
    .filter(([k]) => !omit.includes(k))
    .map(
      ([k, v], i) =>
        `<tr ${i % 2 === 0 ? "" : 'style="background:#f9f9f9"'}>
        <td style="padding:8px;color:#666;width:200px">${esc(k)}</td>
        <td style="padding:8px">${esc(v)}</td>
      </tr>`
    )
    .join("");
}

export async function emailPrecalificacion(
  data: Record<string, unknown>,
  attachments: EmailAttachment[] = []
): Promise<EmailResult> {
  const servicio = String(data.servicio ?? "").toLowerCase();
  const nombre = String(data.nombre ?? "");
  const label = servicio === "cheques" ? "Descuento de cheques" : "Préstamo";

  const subject = `[Vertix] Nueva pre-calificación: ${label} — ${nombre}`;

  const adjuntar = attachments.length > 0 && withinAttachmentLimit(attachments);
  const adjuntosLine = attachments.length
    ? `<p style="margin-top:16px;color:#666;font-size:13px">📎 ${attachments.length} adjunto(s)${
        adjuntar ? " (incluidos en este email)" : " — superan el tope, gestionarlos por el CRM"
      }.</p>`
    : "";

  const html = `
    <h2 style="color:#1B2A4E">Nueva solicitud de pre-calificación</h2>
    <p style="color:#666">Servicio: <strong>${label}</strong></p>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif">${tablaRows(data)}</table>
    ${adjuntosLine}
  `;
  return send(subject, html, adjuntar ? attachments : undefined);
}

export async function emailAlta(
  data: Record<string, unknown>,
  attachments: EmailAttachment[] = []
): Promise<EmailResult> {
  const tipo = String(data.tipo ?? "") === "fisica" ? "Persona física" : "Persona jurídica";
  const nombre = String(data.razon_social ?? `${data.apellido ?? ""}, ${data.nombre ?? ""}`);
  const subject = `[Vertix] Nueva alta de cuenta: ${tipo} — ${nombre}`;

  const adjuntar = attachments.length > 0 && withinAttachmentLimit(attachments);
  const adjuntosLine = attachments.length
    ? `<p style="margin-top:16px;color:#666;font-size:13px">📎 ${attachments.length} adjunto(s)${
        adjuntar ? " (incluidos en este email)" : " — superan el tope, gestionarlos por el CRM"
      }.</p>`
    : "";

  const html = `
    <h2 style="color:#1B2A4E">Nueva alta de cuenta comitente</h2>
    <p style="color:#666">Tipo: <strong>${tipo}</strong></p>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif">${tablaRows(data)}</table>
    ${adjuntosLine}
  `;
  return send(subject, html, adjuntar ? attachments : undefined);
}
