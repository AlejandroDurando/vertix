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
  attachments?: EmailAttachment[],
  opts?: { to?: string; replyTo?: string }
): Promise<EmailResult> {
  const resend = getResend();
  if (!resend) {
    logger.info("email", "RESEND_API_KEY no configurada — skip");
    return { ok: false, reason: "disabled" };
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts?.to ?? TO,
      subject,
      html,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
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
      <tr><td style="padding:8px;color:#666;width:140px">Nombre</td><td style="padding:8px;font-weight:600">${esc(data.nombre)}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px"><a href="mailto:${esc(data.email)}">${esc(data.email)}</a></td></tr>
      <tr><td style="padding:8px;color:#666">Teléfono</td><td style="padding:8px">${esc(data.telefono)}</td></tr>
      ${data.empresa ? `<tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Empresa</td><td style="padding:8px">${esc(data.empresa)}</td></tr>` : ""}
      <tr><td style="padding:8px;color:#666">Asunto</td><td style="padding:8px">${esc(data.asunto)}</td></tr>
      <tr style="background:#f9f9f9"><td style="padding:8px;color:#666;vertical-align:top">Mensaje</td><td style="padding:8px;white-space:pre-wrap">${esc(data.mensaje)}</td></tr>
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

// --- Confirmaciones al solicitante ---------------------------------------

/** Etiquetas legibles para el resumen que se le envía al solicitante. */
const CAMPO_LABELS: Record<string, string> = {
  nombre: "Nombre",
  email: "Email",
  telefono: "Teléfono",
  empresa: "Empresa",
  monto_cheque: "Monto del cheque",
  fecha_pago: "Fecha de pago",
  banco_emisor: "Banco emisor",
  cuit_librador: "CUIT del librador",
  cuit_endosatario: "CUIT del endosatario",
  tipo_persona: "Tipo de persona",
  tipo_prestamo: "Tipo de préstamo",
  cuit_solicitante: "CUIT del solicitante",
  monto_solicitado: "Monto solicitado",
  plazo_meses: "Plazo (meses)",
  tipo_ingreso: "Tipo de ingreso",
};

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

function valorLegible(campo: string, v: unknown): string {
  if (campo.startsWith("monto") && typeof v === "number") return ARS.format(v);
  return String(v ?? "—");
}

function tablaResumen(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([k, v]) => k in CAMPO_LABELS && v != null && v !== "")
    .map(
      ([k, v], i) =>
        `<tr ${i % 2 === 0 ? "" : 'style="background:#f9f9f9"'}>
        <td style="padding:8px;color:#666;width:200px">${esc(CAMPO_LABELS[k])}</td>
        <td style="padding:8px">${esc(valorLegible(k, v))}</td>
      </tr>`
    )
    .join("");
}

const DISCLAIMER_CONFIRMACION =
  "Este comprobante confirma la recepción de tu solicitud y no implica aprobación crediticia ni constituye una oferta. La operación está sujeta a análisis y aprobación, y no incluye impuestos, sellados ni otros gastos.";

function layoutConfirmacion(titulo: string, cuerpo: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#1B2A4E">${esc(titulo)}</h2>
      ${cuerpo}
      <p style="margin-top:20px;color:#999;font-size:12px">${DISCLAIMER_CONFIRMACION}</p>
      <p style="color:#999;font-size:12px">Vertix — ante cualquier consulta respondé este email.</p>
    </div>
  `;
}

/** Reporte de la pre-calificación enviada, dirigido al solicitante. */
export async function emailConfirmacionPrecalificacion(
  to: string,
  data: Record<string, unknown>
): Promise<EmailResult> {
  const servicio = String(data.servicio ?? "").toLowerCase();
  const label = servicio === "cheques" ? "descuento de cheques" : "préstamo";
  const nombre = String(data.nombre ?? "");

  const cuerpo = `
    <p>Hola ${esc(nombre)}:</p>
    <p>Recibimos tu solicitud de pre-calificación de <strong>${esc(label)}</strong>.
    Nuestro equipo la va a revisar y se va a contactar con vos a la brevedad.</p>
    <p style="color:#666;font-size:14px">Resumen de lo enviado:</p>
    <table style="border-collapse:collapse;width:100%">${tablaResumen(data)}</table>
  `;

  return send(
    "Recibimos tu solicitud de pre-calificación — Vertix",
    layoutConfirmacion("Solicitud recibida", cuerpo),
    undefined,
    { to, replyTo: TO }
  );
}

/** Confirmación del alta de cuenta comitente, dirigida al solicitante. */
export async function emailConfirmacionAlta(
  to: string,
  resumen: {
    nombre: string; // nombre y apellido o razón social
    tipo: "fisica" | "juridica";
    alyc: string;
    adjuntos: string[]; // etiquetas legibles de los documentos recibidos
  }
): Promise<EmailResult> {
  const tipoLabel = resumen.tipo === "fisica" ? "persona física" : "persona jurídica";
  const alycLabel = resumen.alyc === "adcap" ? "AdCap" : "Sailing";

  const docs = resumen.adjuntos
    .map((d) => `<li style="padding:2px 0">${esc(d)}</li>`)
    .join("");

  const cuerpo = `
    <p>Hola ${esc(resumen.nombre)}:</p>
    <p>Recibimos tu solicitud de <strong>alta de cuenta comitente</strong>
    (${esc(tipoLabel)}, ALyC ${esc(alycLabel)}) junto con la siguiente documentación:</p>
    <ul style="color:#333;font-size:14px">${docs}</ul>
    <p>Vamos a revisar todo y nos contactamos con vos para continuar con la apertura.
    Si falta algo o hay que corregir un documento, te lo pedimos por este medio.</p>
  `;

  return send(
    "Recibimos tu solicitud de alta de cuenta — Vertix",
    layoutConfirmacion("Solicitud de alta recibida", cuerpo),
    undefined,
    { to, replyTo: TO }
  );
}
