/**
 * Almacenamiento durable de los adjuntos en un bucket S3-compatible
 * (Cloudflare R2).
 *
 * Por qué existe: hasta ahora la documentación de las altas viajaba
 * únicamente como adjunto de un email. Si Resend fallaba o el conjunto
 * superaba su tope, el legajo no quedaba en ningún lado. Además, mandar los
 * archivos dentro del formulario chocaba con el límite de 4,5MB de Vercel.
 *
 * Cómo funciona: el navegador pide una URL firmada, sube el archivo
 * directamente al bucket (sin pasar por el servidor, así que el límite deja de
 * aplicar) y el formulario viaja sólo con las claves de los objetos. En la
 * planilla y en el email se guardan enlaces de descarga.
 *
 * Se eligió S3-compatible y no Google Drive porque las service accounts de
 * Google no tienen cuota propia (`files.create` falla con "Service Accounts do
 * not have storage quota") y una unidad compartida exigiría Google Workspace.
 * Con S3 el mismo código sirve para R2, S3 o MinIO cuando migren de hosting.
 *
 * Si las variables de entorno no están configuradas, `storageHabilitado()`
 * devuelve false y toda la aplicación sigue funcionando como antes: los
 * adjuntos viajan dentro del formulario y se mandan por email.
 */

import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "./logger";

/** Minutos que vive la URL de subida. Alcanza de sobra para un archivo. */
const EXPIRA_SUBIDA_S = 10 * 60;
/** Minutos que vive el enlace de descarga que se entrega al equipo. */
const EXPIRA_DESCARGA_S = 15 * 60;

export function storageHabilitado(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}

let cliente: S3Client | null = null;

function getCliente(): S3Client {
  if (cliente) return cliente;
  cliente = new S3Client({
    // R2 ignora la región pero el SDK exige una; "auto" es lo que documenta
    // Cloudflare.
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return cliente;
}

/** Deja el nombre en algo seguro para usar como parte de una clave. */
export function normalizarNombre(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // acentos
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-80);
  return limpio || "archivo";
}

/**
 * Clave del objeto: carpeta por trámite y fecha, para que el bucket se pueda
 * recorrer a mano. El UUID evita colisiones y hace la clave no adivinable.
 */
export function construirClave(opts: {
  tramite: string; // "alta" | "precalificacion"
  campo: string;
  nombre: string;
  fecha?: Date;
}): string {
  const f = opts.fecha ?? new Date();
  const dia = f.toISOString().slice(0, 10);
  return `${opts.tramite}/${dia}/${randomUUID()}/${normalizarNombre(
    opts.campo
  )}-${normalizarNombre(opts.nombre)}`;
}

/** URL firmada para que el navegador suba el archivo directo al bucket. */
export async function firmarSubida(opts: {
  clave: string;
  tipo: string;
}): Promise<string> {
  const comando = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: opts.clave,
    ContentType: opts.tipo,
  });
  return getSignedUrl(getCliente(), comando, { expiresIn: EXPIRA_SUBIDA_S });
}

/** URL firmada de descarga, para abrir el documento desde el CRM. */
export async function firmarDescarga(clave: string): Promise<string> {
  const comando = new GetObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: clave,
  });
  return getSignedUrl(getCliente(), comando, { expiresIn: EXPIRA_DESCARGA_S });
}

/**
 * Enlace estable que se guarda en la planilla y en los emails. No es la URL
 * firmada (que expira en minutos) sino la del endpoint propio, que verifica el
 * token y recién ahí redirige al bucket.
 */
export function enlaceDescarga(clave: string): string {
  const base = process.env.APP_URL ?? "";
  const token = tokenDescarga(clave);
  return `${base}/api/adjuntos?clave=${encodeURIComponent(clave)}&token=${token}`;
}

/**
 * Token por objeto, derivado del secreto del servidor. Evita que alguien que
 * conozca una clave pueda armar el enlace de otra, y hace que los enlaces no
 * caduquen (lo importante para un legajo que se consulta meses después).
 */
export function tokenDescarga(clave: string): string {
  const secreto = process.env.ADJUNTOS_SECRET ?? "";
  return createHash("sha256").update(`${secreto}:${clave}`).digest("hex").slice(0, 32);
}

export function tokenValido(clave: string, token: string): boolean {
  if (!process.env.ADJUNTOS_SECRET) return false;
  const esperado = tokenDescarga(clave);
  // Comparación de largo fijo; los dos son hex de 32 caracteres.
  if (token.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function logStorage(evento: string, datos?: Record<string, unknown>) {
  logger.info("storage", evento, datos);
}
