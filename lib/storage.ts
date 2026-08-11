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
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { hoy } from "./fechas";
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
 * Clave del objeto: `tramite/cliente/fecha-id-del-envío/campo-nombre`.
 *
 * Todos los documentos de un mismo envío comparten el `tramiteId`, así que la
 * carpeta ES el legajo: se puede listar completo con una sola consulta y
 * entregarlo en un zip. El id es un UUID, con lo cual la carpeta tampoco se
 * puede adivinar.
 *
 * El segundo nivel es el cliente para que todos sus envíos queden juntos. Los
 * legajos anteriores al 07/08/2026 tienen la fecha en ese nivel, sin registro
 * de a quién pertenecen: `partesCarpeta()` entiende las dos formas.
 */
export function construirClave(opts: {
  tramite: string; // "alta" | "precalificacion"
  cliente?: string;
  tramiteId: string;
  campo: string;
  nombre: string;
  fecha?: Date;
}): string {
  // hoy() y no new Date(): el servidor corre en UTC y a partir de las 21:00 ART
  // un legajo quedaría archivado con la fecha del día siguiente.
  const f = opts.fecha ?? hoy();
  const dia = f.toISOString().slice(0, 10);
  const id = /^[0-9a-f-]{36}$/i.test(opts.tramiteId) ? opts.tramiteId : randomUUID();
  const cliente = normalizarNombre(opts.cliente?.trim() || "sin-identificar");
  return `${opts.tramite}/${cliente}/${dia}-${id}/${normalizarNombre(
    opts.campo
  )}-${normalizarNombre(opts.nombre)}`;
}

/** Carpeta (legajo) a la que pertenece una clave. */
export function carpetaDe(clave: string): string {
  const partes = clave.split("/");
  return partes.length >= 4 ? partes.slice(0, 3).join("/") + "/" : "";
}

const EMPIEZA_CON_FECHA = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Descompone la carpeta de un legajo en sus partes legibles, soportando las dos
 * estructuras: la actual (`tramite/cliente/fecha-id/`) y la anterior
 * (`tramite/fecha/id/`), que no registraba el cliente.
 */
export function partesCarpeta(carpeta: string): {
  tramite: string;
  cliente: string | null;
  fecha: string;
} {
  const [tramite = "", segundo = "", tercero = ""] = carpeta.split("/");
  const fechaVieja = EMPIEZA_CON_FECHA.exec(segundo);
  if (fechaVieja) return { tramite, cliente: null, fecha: fechaVieja[1] };
  return {
    tramite,
    cliente: segundo || null,
    fecha: EMPIEZA_CON_FECHA.exec(tercero)?.[1] ?? "",
  };
}

export type DocumentoLegajo = {
  clave: string;
  campo: string;
  nombre: string;
  bytes: number;
};

/** Lista los documentos de un legajo, en el orden en que se subieron. */
export async function listarLegajo(carpeta: string): Promise<DocumentoLegajo[]> {
  const res = await getCliente().send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: carpeta })
  );
  return (res.Contents ?? [])
    // El marcador no es un documento del solicitante: no se muestra ni se baja.
    .filter((o) => o.Key && o.Size != null && !o.Key.endsWith(MARCADOR_LEGAJO))
    .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0))
    .map((o) => {
      const archivo = o.Key!.slice(carpeta.length);
      const guion = archivo.indexOf("-");
      return {
        clave: o.Key!,
        campo: guion > 0 ? archivo.slice(0, guion) : archivo,
        nombre: guion > 0 ? archivo.slice(guion + 1) : archivo,
        bytes: o.Size!,
      };
    });
}

/**
 * Archivo que marca que el envío se completó.
 *
 * Los documentos se suben ANTES de que el formulario se envíe, así que un
 * intento abandonado —o uno que el servidor rechazó y la persona corrigió y
 * volvió a mandar— deja una carpeta con archivos que no corresponde a ninguna
 * solicitud. Sólo las carpetas con este archivo son legajos de verdad.
 */
export const MARCADOR_LEGAJO = "_legajo.json";

export type DatosLegajo = {
  tramite: string;
  /** Razón social, o apellido y nombre. */
  nombre: string;
  cuit: string;
  email?: string;
  recibido_el: string; // YYYY-MM-DD
};

/** Marca la carpeta como legajo completo. Nunca lanza: no debe tumbar el envío. */
export async function marcarLegajoCompleto(
  carpeta: string,
  datos: DatosLegajo
): Promise<void> {
  if (!carpeta || !storageHabilitado()) return;
  try {
    await getCliente().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: `${carpeta}${MARCADOR_LEGAJO}`,
        Body: JSON.stringify(datos),
        ContentType: "application/json",
      })
    );
  } catch (err) {
    logger.error("storage", "No se pudo marcar el legajo como completo", {
      carpeta,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function leerDatosLegajo(carpeta: string): Promise<DatosLegajo | null> {
  try {
    const crudo = await leerObjeto(`${carpeta}${MARCADOR_LEGAJO}`);
    return JSON.parse(crudo.toString("utf8")) as DatosLegajo;
  } catch {
    return null;
  }
}

export type ResumenLegajo = {
  carpeta: string;
  tramite: string;
  /** Carpeta del cliente; `null` en los legajos viejos, que no la registraban. */
  cliente: string | null;
  fecha: string; // YYYY-MM-DD
  documentos: number;
  bytes: number;
  datos: DatosLegajo | null;
};

/** Tope de objetos que recorre el índice; hoy hay decenas, no miles. */
const MAX_OBJETOS_INDICE = 5000;

/**
 * Los legajos completos del bucket, agrupados por carpeta y ordenados del más
 * reciente al más viejo. Alimenta la página /legajos.
 *
 * `incompletos` cuenta las carpetas con archivos pero sin envío confirmado, que
 * no se listan: son intentos abandonados o reenvíos.
 */
export async function listarLegajos(): Promise<{
  legajos: ResumenLegajo[];
  incompletos: number;
}> {
  const porCarpeta = new Map<string, ResumenLegajo>();
  const completas = new Set<string>();
  let token: string | undefined;
  let leidos = 0;

  do {
    const res = await getCliente().send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        ContinuationToken: token,
      })
    );

    for (const obj of res.Contents ?? []) {
      if (!obj.Key || obj.Size == null) continue;
      const carpeta = carpetaDe(obj.Key);
      if (!carpeta) continue;

      if (obj.Key.endsWith(MARCADOR_LEGAJO)) {
        completas.add(carpeta);
        continue; // el marcador no es un documento del legajo
      }

      const actual = porCarpeta.get(carpeta);
      if (actual) {
        actual.documentos += 1;
        actual.bytes += obj.Size;
      } else {
        porCarpeta.set(carpeta, {
          carpeta,
          ...partesCarpeta(carpeta),
          documentos: 1,
          bytes: obj.Size,
          datos: null,
        });
      }
    }

    leidos += res.Contents?.length ?? 0;
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && leidos < MAX_OBJETOS_INDICE);

  const legajos = [...porCarpeta.values()].filter((l) => completas.has(l.carpeta));

  // Los datos del cliente salen del marcador, que los guardó el servidor con el
  // formulario ya validado.
  await Promise.all(
    legajos.map(async (l) => {
      l.datos = await leerDatosLegajo(l.carpeta);
    })
  );

  return {
    legajos: legajos.sort((a, b) => b.fecha.localeCompare(a.fecha)),
    incompletos: porCarpeta.size - legajos.length,
  };
}

/** Descarga el contenido de un objeto (para armar el zip). */
export async function leerObjeto(clave: string): Promise<Buffer> {
  const res = await getCliente().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: clave })
  );
  return Buffer.from(await res.Body!.transformToByteArray());
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
 * Enlace al legajo completo: una sola dirección por envío, que es la que queda
 * en el CRM. Abre la página con todos los documentos y el botón para bajarlos
 * en un zip.
 */
export function enlaceLegajo(carpeta: string): string {
  const base = process.env.APP_URL ?? "";
  const token = tokenDescarga(carpeta);
  return `${base}/legajo?carpeta=${encodeURIComponent(carpeta)}&token=${token}`;
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
