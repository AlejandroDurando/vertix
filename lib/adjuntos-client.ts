/**
 * Compresión de adjuntos en el navegador, antes de subirlos.
 *
 * Una foto de DNI sacada con el celular pesa entre 3 y 8MB, y Vercel rechaza
 * los requests de más de 4,5MB: el alta de persona jurídica, que pide siete
 * documentos, no llegaba a enviarse. Redimensionar a 2000px de lado largo y
 * reexportar como JPEG deja las fotos en 300–600KB sin perder legibilidad (un
 * DNI a 2000px se lee sin problemas).
 *
 * Los PDF se dejan intactos: no se pueden comprimir por esta vía.
 */

/** Lado más largo al que se redimensionan las imágenes. */
export const MAX_LADO_PX = 2000;
/** Calidad del JPEG resultante. */
const CALIDAD_JPEG = 0.82;
/** Por debajo de esto no vale la pena recomprimir. */
const MINIMO_PARA_COMPRIMIR = 300 * 1024;

/** Tope del envío completo. Vercel corta en 4,5MB; se deja margen para los campos. */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const COMPRIMIBLES = ["image/jpeg", "image/png", "image/webp"];

export function formatearBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function aJpeg(nombre: string): string {
  return nombre.replace(/\.[^.]+$/, "") + ".jpg";
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", CALIDAD_JPEG)
  );
}

/**
 * Devuelve una versión más liviana de la imagen. Si el archivo no es una imagen
 * comprimible, si ya es chico, o si algo falla, devuelve el original: la
 * compresión nunca debe impedir que la persona envíe el formulario.
 */
export async function comprimirImagen(file: File): Promise<File> {
  if (!COMPRIMIBLES.includes(file.type) || file.size < MINIMO_PARA_COMPRIMIR) {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const escala = Math.min(1, MAX_LADO_PX / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    // Fondo blanco: los PNG con transparencia quedarían negros al pasar a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await toBlob(canvas);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], aJpeg(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export type ResumenAdjuntos = {
  /** Peso total de los archivos ya comprimidos. */
  total: number;
  /** Archivos ordenados de más a menos pesado (sólo los que quedaron cargados). */
  archivos: { campo: string; nombre: string; bytes: number }[];
};

/**
 * Comprime in situ todas las imágenes del FormData y devuelve el peso final.
 * Mutá el FormData que recibe: los campos de archivo quedan reemplazados por
 * su versión liviana.
 */
export async function comprimirAdjuntos(fd: FormData): Promise<ResumenAdjuntos> {
  const archivos: ResumenAdjuntos["archivos"] = [];
  let total = 0;

  const entradas: [string, File][] = [];
  fd.forEach((valor, campo) => {
    if (valor instanceof File && valor.size > 0) entradas.push([campo, valor]);
  });

  for (const [campo, file] of entradas) {
    const comprimido = await comprimirImagen(file);
    if (comprimido !== file) fd.set(campo, comprimido);
    total += comprimido.size;
    archivos.push({ campo, nombre: comprimido.name, bytes: comprimido.size });
  }

  archivos.sort((a, b) => b.bytes - a.bytes);
  return { total, archivos };
}

/**
 * Sube los archivos directo al bucket y reemplaza cada campo de archivo del
 * FormData por su referencia (`campo__clave` y `campo__nombre`), de modo que el
 * formulario viaje sólo con texto y el límite de 4,5MB deje de aplicar.
 *
 * Devuelve `"sin-storage"` si el servidor todavía no tiene el bucket
 * configurado: en ese caso el formulario sigue con el camino viejo, mandando
 * los archivos dentro del multipart.
 */
export async function subirAdjuntos(
  fd: FormData,
  tramite: "alta" | "precalificacion"
): Promise<"ok" | "sin-storage" | { error: string }> {
  const entradas: [string, File][] = [];
  fd.forEach((valor, campo) => {
    if (valor instanceof File && valor.size > 0) entradas.push([campo, valor]);
  });
  if (entradas.length === 0) return "ok";

  for (const [campo, file] of entradas) {
    let firma: Response;
    try {
      firma = await fetch("/api/adjuntos/firmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tramite,
          campo,
          nombre: file.name,
          tipo: file.type,
          tamano: file.size,
        }),
      });
    } catch {
      return { error: "No se pudo conectar con el servidor para subir los archivos." };
    }

    // El servidor avisa así que el bucket no está configurado todavía.
    if (firma.status === 503) return "sin-storage";

    const cuerpo = (await firma.json().catch(() => null)) as
      | { success: true; data: { url: string; clave: string } }
      | { success: false; error: string }
      | null;

    if (!cuerpo || !cuerpo.success) {
      return {
        error: cuerpo?.success === false ? cuerpo.error : "No pudimos preparar la subida.",
      };
    }

    try {
      const put = await fetch(cuerpo.data.url, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        return { error: `No pudimos subir "${file.name}". Intentá nuevamente.` };
      }
    } catch {
      return {
        error: `Se interrumpió la subida de "${file.name}". Revisá tu conexión e intentá nuevamente.`,
      };
    }

    fd.delete(campo);
    fd.set(`${campo}__clave`, cuerpo.data.clave);
    fd.set(`${campo}__nombre`, file.name);
  }

  return "ok";
}

/** Mensaje de error cuando el envío sigue siendo demasiado pesado. */
export function mensajeExcedido(resumen: ResumenAdjuntos): string {
  const pesados = resumen.archivos
    .slice(0, 3)
    .map((a) => `${a.nombre} (${formatearBytes(a.bytes)})`)
    .join(", ");
  return `Los archivos suman ${formatearBytes(resumen.total)} y el máximo por envío es ${formatearBytes(
    MAX_TOTAL_BYTES
  )}. Los más pesados son: ${pesados}. Probá con fotos de menor resolución o subí los documentos en PDF.`;
}
