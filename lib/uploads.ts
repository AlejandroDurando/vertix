import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from "./validations";

export type ParsedFile = {
  nombre: string;
  tipo: string;
  tamano: number;
  base64: string;
};

export type ReadUploadsResult =
  | { data: Record<string, unknown>; files: Record<string, ParsedFile> }
  | { error: string };

/**
 * Lee un FormData: convierte los campos numéricos indicados a number,
 * el resto a string, y valida/decodifica los archivos cuyos nombres estén
 * en `fileFields` (tipo y tamaño permitidos).
 */
export async function readUploads(
  form: FormData,
  opts: { numericFields?: string[]; fileFields: string[] }
): Promise<ReadUploadsResult> {
  const numericFields = new Set(opts.numericFields ?? []);
  const fileFields = new Set(opts.fileFields);
  const data: Record<string, unknown> = {};
  const files: Record<string, ParsedFile> = {};

  for (const [key, raw] of form.entries()) {
    if (raw instanceof File) {
      if (!fileFields.has(key)) continue;
      if (raw.size === 0) continue; // input vacío
      if (raw.size > MAX_FILE_SIZE) {
        return { error: `El archivo "${raw.name}" supera el tamaño máximo de 5MB.` };
      }
      if (!ALLOWED_FILE_TYPES.includes(raw.type)) {
        return { error: `Formato no permitido en "${raw.name}" (PDF o imagen).` };
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
    data[key] = numericFields.has(key)
      ? (Number.isFinite(Number(value)) ? Number(value) : value)
      : value;
  }

  return { data, files };
}
