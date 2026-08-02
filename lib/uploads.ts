import { MAX_FILE_SIZE, formatosPermitidos, tiposPermitidos } from "./validations";

export type ParsedFile = {
  nombre: string;
  tipo: string;
  tamano: number;
  base64: string;
};

/** Archivo que el navegador ya subió al bucket: sólo llega su referencia. */
export type SubidoRef = {
  nombre: string;
  clave: string;
};

export type ReadUploadsResult =
  | {
      data: Record<string, unknown>;
      files: Record<string, ParsedFile>;
      subidos: Record<string, SubidoRef>;
    }
  | { error: string };

/** Sufijos con los que el formulario referencia un archivo ya subido al bucket. */
const SUFIJO_CLAVE = "__clave";
const SUFIJO_NOMBRE = "__nombre";

/**
 * Lee un FormData: convierte los campos numéricos indicados a number,
 * el resto a string, y valida/decodifica los archivos cuyos nombres estén
 * en `fileFields` (tipo y tamaño permitidos).
 *
 * Cuando el almacenamiento está configurado, el navegador sube los archivos
 * directo al bucket y en su lugar manda `<campo>__clave` y `<campo>__nombre`:
 * esos pares se devuelven en `subidos` y no cuentan como campos de datos.
 */
export async function readUploads(
  form: FormData,
  opts: { numericFields?: string[]; fileFields: string[] }
): Promise<ReadUploadsResult> {
  const numericFields = new Set(opts.numericFields ?? []);
  const fileFields = new Set(opts.fileFields);
  const data: Record<string, unknown> = {};
  const files: Record<string, ParsedFile> = {};
  const subidos: Record<string, SubidoRef> = {};

  for (const [key, raw] of form.entries()) {
    if (raw instanceof File) {
      if (!fileFields.has(key)) continue;
      if (raw.size === 0) continue; // input vacío
      if (raw.size > MAX_FILE_SIZE) {
        return { error: `El archivo "${raw.name}" supera el tamaño máximo de 5MB.` };
      }
      if (!tiposPermitidos(key).includes(raw.type)) {
        return {
          error: `Formato no permitido en "${raw.name}" (${formatosPermitidos(key)}).`,
        };
      }
      const buffer = Buffer.from(await raw.arrayBuffer());
      files[key] = {
        nombre: raw.name,
        tipo: raw.type,
        tamano: raw.size,
        base64: buffer.toString("base64"),
      };
      continue;
    }

    const value = String(raw);

    // Referencias a archivos ya subidos al bucket.
    if (key.endsWith(SUFIJO_CLAVE)) {
      const campo = key.slice(0, -SUFIJO_CLAVE.length);
      if (fileFields.has(campo) && value) {
        subidos[campo] = { clave: value, nombre: subidos[campo]?.nombre ?? "" };
      }
      continue;
    }
    if (key.endsWith(SUFIJO_NOMBRE)) {
      const campo = key.slice(0, -SUFIJO_NOMBRE.length);
      if (fileFields.has(campo)) {
        subidos[campo] = { clave: subidos[campo]?.clave ?? "", nombre: value };
      }
      continue;
    }

    data[key] = numericFields.has(key)
      ? (Number.isFinite(Number(value)) ? Number(value) : value)
      : value;
  }

  // Una referencia sin clave no sirve: se descarta para que el chequeo de
  // obligatorios la trate como faltante.
  for (const [campo, ref] of Object.entries(subidos)) {
    if (!ref.clave) delete subidos[campo];
  }

  return { data, files, subidos };
}
