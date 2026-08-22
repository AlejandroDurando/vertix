import JSZip from "jszip";
import { esCuitValido, normalizarCuit } from "./cuit";

/**
 * Lectura de cheques desde los archivos que manda el cliente.
 *
 * Tres caminos, del más barato y exacto al más incierto:
 *
 * 1. **Planilla** (CSV o Excel exportado del banco): se mapean las columnas.
 *    Es lectura exacta y no sale nada del servidor.
 * 2. **PDF con capa de texto**: se extrae el texto y se interpreta línea por
 *    línea. Tampoco sale nada del servidor.
 * 3. **Imagen o PDF escaneado**: modelo multimodal (paso 5 del plan).
 *
 * Todo queda detrás de `leerCheques()`: cambiar de proveedor para el punto 3 es
 * tocar este archivo y ninguno más.
 */

export type ChequeLeido = {
  nominal: number | null;
  fecha_pago: string | null; // YYYY-MM-DD
  cuit_librador: string | null;
  banco: string | null;
  numero: string | null;
  /**
   * El importe en letras ya convertido a número, para cotejarlo contra el de
   * los dígitos. `null` cuando el documento no lo trae (una planilla, por
   * ejemplo): sólo el cheque en sí repite el dato dos veces.
   */
  nominal_en_letras: number | null;
  origen: string;
};

/** Lo que se puede arrastrar a la tabla del lote. */
export const TIPOS_LECTURA = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "text/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

/** Formatos aceptados, en texto, para los mensajes de error. */
export const FORMATOS_LECTURA = "PDF, imagen, CSV o Excel";

export type ArchivoEntrada = {
  nombre: string;
  tipo: string;
  datos: Uint8Array;
};

/** Por dónde entró la lectura: dice qué tan confiable es lo que se leyó. */
export type ViaLectura = "planilla" | "pdf-texto" | "modelo";

export type LecturaResultado = {
  cheques: ChequeLeido[];
  via: ViaLectura;
  /** Por qué no se pudo leer, cuando no se pudo. Se muestra junto al archivo. */
  motivo?: string;
};

/**
 * Piso para tomar un número de una línea como el importe del cheque. No es una
 * regla del negocio: evita que un "2,5%" o un número de página se cuelen como
 * si fueran plata.
 */
const IMPORTE_MINIMO = 1000;

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// --- Piezas sueltas: importes, fechas y CUIT dentro de un texto ---

const RE_FECHA = /\b(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g;
const RE_CUIT = /\b(\d{2})[-\s]?(\d{8})[-\s]?(\d)\b/g;
const RE_IMPORTE = /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b|\b\d+[.,]\d{1,2}\b|\b\d+\b/g;

/**
 * Convierte un importe escrito como sea a número. El separador decimal es el
 * último de los dos que aparezca: así entran tanto `1.234.567,89` (el formato
 * de acá) como `1,234,567.89` (el de algunos exports).
 */
export function parsearImporte(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,]/g, "");
  if (!limpio) return null;

  const ultimoPunto = limpio.lastIndexOf(".");
  const ultimaComa = limpio.lastIndexOf(",");
  let entero = limpio;
  let decimales = "";

  if (ultimoPunto >= 0 || ultimaComa >= 0) {
    const corte = Math.max(ultimoPunto, ultimaComa);
    const cola = limpio.slice(corte + 1);
    // Tres dígitos después del separador son miles, no centavos.
    if (cola.length > 0 && cola.length <= 2) {
      entero = limpio.slice(0, corte);
      decimales = cola;
    }
  }

  const n = Number(`${entero.replace(/[.,]/g, "")}.${decimales || "0"}`);
  return Number.isFinite(n) ? n : null;
}

/** Fechas en dd/mm/aaaa, dd-mm-aa o aaaa-mm-dd. Devuelve YYYY-MM-DD. */
export function parsearFecha(texto: string): string | null {
  RE_FECHA.lastIndex = 0;
  const m = RE_FECHA.exec(texto.trim());
  if (!m) return null;
  const [, a, b, c] = m as unknown as [string, string, string, string];

  let anio: number;
  let mes: number;
  let dia: number;
  if (a.length === 4) {
    [anio, mes, dia] = [Number(a), Number(b), Number(c)];
  } else {
    [dia, mes] = [Number(a), Number(b)];
    anio = Number(c);
    if (c.length === 2) anio += 2000;
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 2000 || anio > 2100) {
    return null;
  }
  const iso = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  // Un 31 de febrero pasa los rangos pero no existe.
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDate() === dia && d.getUTCMonth() + 1 === mes ? iso : null;
}

/** Primer CUIT válido del texto (con o sin guiones). */
export function buscarCuit(texto: string): string | null {
  RE_CUIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_CUIT.exec(texto))) {
    const cuit = normalizarCuit(m[0]);
    if (esCuitValido(cuit)) return cuit;
  }
  return null;
}

// --- Camino 1: planillas (CSV y Excel) ---

type Columna = "monto" | "monto_aceptado" | "fecha_pago" | "cuit_librador" | "banco" | "numero";

const PALABRAS: Record<Columna, string[]> = {
  monto: ["importe", "monto", "valor", "nominal", "capital", "total"],
  monto_aceptado: ["aceptado"],
  fecha_pago: ["vencimiento", "vto", "fecha de pago", "fecha pago", "pago", "fecha"],
  cuit_librador: ["cuit", "cuil"],
  banco: ["banco", "entidad", "girado"],
  numero: ["numero", "nro", "n°", "cheque", "documento", "comprobante"],
};

/** Qué columna es cada encabezado. El primero que coincide se queda con ella. */
function mapearColumnas(encabezados: string[]): Partial<Record<Columna, number>> {
  const mapa: Partial<Record<Columna, number>> = {};
  encabezados.forEach((crudo, i) => {
    const h = sinAcentos(crudo);
    if (!h) return;
    for (const [columna, palabras] of Object.entries(PALABRAS) as [Columna, string[]][]) {
      if (mapa[columna] !== undefined) continue;
      if (palabras.some((p) => h.includes(p))) {
        mapa[columna] = i;
        return;
      }
    }
  });
  return mapa;
}

/** Separa una línea de CSV respetando las comillas. */
function partirCsv(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        entreComillas = !entreComillas;
      }
    } else if (c === sep && !entreComillas) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

/**
 * El separador no se adivina mirando la primera línea: los exports arrancan con
 * un título suelto, sin separador ninguno. Se prueban los tres y gana el que
 * más cheques encuentra.
 */
export function leerCsv(texto: string, origen: string): ChequeLeido[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return [];

  let mejor: ChequeLeido[] = [];
  for (const sep of [";", "\t", ","]) {
    const cheques = filasAcheques(
      lineas.map((l) => partirCsv(l, sep)),
      origen
    );
    if (cheques.length > mejor.length) mejor = cheques;
  }
  return mejor;
}

/**
 * Convierte una matriz de celdas (venga de CSV o de Excel) en cheques. La
 * primera fila con al menos dos columnas reconocibles es el encabezado: los
 * exports de los bancos suelen traer títulos y logos antes de la tabla.
 */
function filasAcheques(filas: string[][], origen: string): ChequeLeido[] {
  let mapa: Partial<Record<Columna, number>> = {};
  let inicio = -1;
  for (let i = 0; i < filas.length; i++) {
    const candidato = mapearColumnas(filas[i]!);
    if (candidato.monto !== undefined && Object.keys(candidato).length >= 2) {
      mapa = candidato;
      inicio = i + 1;
      break;
    }
  }
  if (inicio < 0) return [];

  const cheques: ChequeLeido[] = [];
  for (const fila of filas.slice(inicio)) {
    const celda = (c: Columna) => {
      const i = mapa[c];
      return i === undefined ? "" : (fila[i] ?? "").trim();
    };
    const nominal = parsearImporte(celda("monto"));
    const fecha = parsearFecha(celda("fecha_pago")) ?? fechaDeSerieExcel(celda("fecha_pago"));
    if (nominal === null && fecha === null) continue; // fila vacía o pie de tabla

    const cuit = buscarCuit(celda("cuit_librador"));
    const numero = celda("numero").replace(/\D/g, "");
    cheques.push({
      nominal,
      fecha_pago: fecha,
      cuit_librador: cuit,
      banco: celda("banco") || null,
      numero: numero || null,
      nominal_en_letras: null,
      origen,
    });
  }
  return cheques;
}

/**
 * Excel guarda las fechas como días desde el 1/1/1900, con el bug histórico
 * del 29/2/1900 que nunca existió: por eso el desplazamiento es de 25.569 días
 * respecto del epoch de Unix.
 */
function fechaDeSerieExcel(valor: string): string | null {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const ms = Math.round(n - 25569) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * Un .xlsx es un zip de XML. Se lee con `jszip`, que ya está en el proyecto
 * para armar los zip de legajos, y así se evita sumar una librería de planillas
 * entera para leer una tabla de seis columnas.
 */
export async function leerXlsx(datos: Uint8Array, origen: string): Promise<ChequeLeido[]> {
  const zip = await JSZip.loadAsync(datos);

  const compartidas: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const partes = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
      compartidas.push(
        desescapar(partes.map((t) => t.replace(/<[^>]+>/g, "")).join(""))
      );
    }
  }

  const hoja =
    zip.file("xl/worksheets/sheet1.xml") ??
    zip.file(/xl\/worksheets\/.*\.xml/)[0] ??
    null;
  if (!hoja) return [];
  const xml = await hoja.async("string");

  const filas: string[][] = [];
  for (const filaXml of xml.match(/<row[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const celdas: string[] = [];
    for (const celdaXml of filaXml.match(/<c[\s\S]*?<\/c>|<c[^>]*\/>/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(celdaXml)?.[1];
      const i = ref ? columnaDeRef(ref) : celdas.length;
      const tipo = /t="([^"]+)"/.exec(celdaXml)?.[1];
      const crudo = /<v>([\s\S]*?)<\/v>/.exec(celdaXml)?.[1] ?? "";
      const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(celdaXml)?.[1];
      const valor =
        tipo === "s"
          ? (compartidas[Number(crudo)] ?? "")
          : tipo === "inlineStr"
            ? desescapar(inline ?? "")
            : desescapar(crudo);
      while (celdas.length < i) celdas.push("");
      celdas[i] = valor;
    }
    filas.push(celdas);
  }

  return filasAcheques(filas, origen);
}

/** `A` → 0, `B` → 1, `AA` → 26. */
function columnaDeRef(ref: string): number {
  let n = 0;
  for (const c of ref) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// --- Camino 2: PDF con capa de texto ---

/**
 * Interpreta el texto plano de un PDF. Una línea que tenga una fecha y un
 * importe es un cheque: es la forma que tienen los listados de echeq de los
 * bancos. Si ninguna línea califica se toma el documento entero como un solo
 * cheque, que es el caso del PDF de un valor suelto.
 */
export function interpretarTexto(texto: string, origen: string): ChequeLeido[] {
  const filas: ChequeLeido[] = [];

  for (const linea of texto.split(/\r?\n/)) {
    const cheque = interpretarLinea(linea, origen);
    if (cheque) filas.push(cheque);
  }
  if (filas.length > 0) return filas;

  const suelto = interpretarLinea(texto.replace(/\s+/g, " "), origen);
  return suelto ? [suelto] : [];
}

function interpretarLinea(linea: string, origen: string): ChequeLeido | null {
  // Las fechas y los CUIT se sacan del camino antes de buscar importes: si no,
  // el "2026" de un vencimiento o los once dígitos de un CUIT se leerían como
  // plata.
  const fechas: string[] = [];
  let resto = linea.replace(RE_FECHA, (m) => {
    const f = parsearFecha(m);
    if (f) fechas.push(f);
    return " ";
  });

  const cuit = buscarCuit(resto);
  resto = resto.replace(RE_CUIT, " ");

  const importes = (resto.match(RE_IMPORTE) ?? [])
    .map(parsearImporte)
    .filter((n): n is number => n !== null && n >= IMPORTE_MINIMO);

  if (fechas.length === 0 || importes.length === 0) return null;

  // El vencimiento es la fecha más lejana de la línea (la otra suele ser la de
  // emisión) y el nominal, el número más grande.
  const fecha_pago = fechas.sort().at(-1) ?? null;
  const nominal = Math.max(...importes);

  // Un número largo que no es plata ni CUIT es el número del cheque.
  const numero =
    (resto.match(/\b\d{6,}\b/g) ?? []).find(
      (n) => parsearImporte(n) !== nominal
    ) ?? null;

  return {
    nominal,
    fecha_pago,
    cuit_librador: cuit,
    banco: null,
    numero,
    nominal_en_letras: null,
    origen,
  };
}

async function textoDePdf(datos: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(datos);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// --- Entrada única ---

const esPlanilla = (a: ArchivoEntrada) =>
  /\.(csv|tsv|txt)$/i.test(a.nombre) || a.tipo.startsWith("text/");
const esExcel = (a: ArchivoEntrada) =>
  /\.xlsx$/i.test(a.nombre) || a.tipo.includes("spreadsheetml");
const esPdf = (a: ArchivoEntrada) =>
  /\.pdf$/i.test(a.nombre) || a.tipo === "application/pdf";

/**
 * Lee los cheques de un archivo. Elige el camino solo: el usuario no configura
 * nada. Un PDF sin capa de texto (escaneado) cae al modelo, igual que una foto.
 */
export async function leerCheques(archivo: ArchivoEntrada): Promise<LecturaResultado> {
  if (esExcel(archivo)) {
    return { cheques: await leerXlsx(archivo.datos, archivo.nombre), via: "planilla" };
  }

  if (esPlanilla(archivo)) {
    const texto = new TextDecoder().decode(archivo.datos);
    return { cheques: leerCsv(texto, archivo.nombre), via: "planilla" };
  }

  if (esPdf(archivo)) {
    const texto = await textoDePdf(archivo.datos);
    // Un escaneo devuelve la capa de texto vacía o con cuatro caracteres
    // sueltos: ahí no hay nada que interpretar y el archivo es, en los hechos,
    // una imagen.
    if (texto.trim().length >= 40) {
      const cheques = interpretarTexto(texto, archivo.nombre);
      if (cheques.length > 0) return { cheques, via: "pdf-texto" };
    }
  }

  if (!leerConModeloDisponible()) {
    return {
      cheques: [],
      via: "modelo",
      motivo:
        "Este archivo es una imagen o un PDF escaneado y la lectura automática no está configurada: cargalo a mano.",
    };
  }

  const cheques = await leerConModelo(archivo);
  return {
    cheques,
    via: "modelo",
    ...(cheques.length === 0
      ? { motivo: "No se reconoció ningún cheque en el archivo. Cargalo a mano." }
      : {}),
  };
}

// --- Camino 3: el modelo, para lo que no se puede leer localmente ---

/**
 * Si la lectura de imágenes está configurada. Sin la clave, el resto del
 * circuito funciona igual y la tabla se carga a mano — mismo criterio que el
 * bucket de adjuntos, que tampoco frena el formulario cuando falta.
 */
export function leerConModeloDisponible(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/**
 * Un cheque es un documento estandarizado, así que se le describe la estructura
 * en vez de pedirle que interprete. Lo importante es la última regla: **un
 * campo vacío es corregible, uno inventado es un error silencioso**, y el que
 * cuesta plata es el importe.
 */
const INSTRUCCIONES = `Sos un lector de cheques, echeq y facturas de crédito electrónica de Argentina.
Devolvé todos los valores que encuentres en el documento. Puede haber uno solo (la foto de un cheque)
o muchos (un listado del banco).

De cada valor:
- nominal: el importe en números, como número sin separadores de miles.
- nominal_en_letras: el importe escrito en palabras, convertido a número. Sólo si figura.
- fecha_pago: la fecha de pago o vencimiento, en formato YYYY-MM-DD. NO la fecha de emisión.
- cuit_librador: el CUIT de quien libra el cheque, 11 dígitos sin guiones.
- banco: el nombre del banco girado.
- numero: el número del cheque.

Reglas:
- Si un dato no está o no lo podés leer con seguridad, devolvé null. Nunca lo inventes ni lo completes
  con lo que te parezca probable.
- No devuelvas totales, subtotales ni renglones que no sean un valor individual.`;

const ESQUEMA = {
  type: "object",
  properties: {
    cheques: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nominal: { type: "number", nullable: true },
          nominal_en_letras: { type: "number", nullable: true },
          fecha_pago: { type: "string", nullable: true },
          cuit_librador: { type: "string", nullable: true },
          banco: { type: "string", nullable: true },
          numero: { type: "string", nullable: true },
        },
      },
    },
  },
  required: ["cheques"],
};

export type ChequeCrudo = Partial<Record<keyof ChequeLeido, unknown>>;

async function leerConModelo(archivo: ArchivoEntrada): Promise<ChequeLeido[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: INSTRUCCIONES },
            {
              inline_data: {
                mime_type: archivo.tipo || "image/jpeg",
                data: Buffer.from(archivo.datos).toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        // Lectura, no redacción: sin margen para elegir entre alternativas.
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: ESQUEMA,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`El lector devolvió ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const texto = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!texto) return [];

  let leidos: ChequeCrudo[];
  try {
    leidos = (JSON.parse(texto) as { cheques?: ChequeCrudo[] }).cheques ?? [];
  } catch {
    return [];
  }

  return leidos.map((c) => normalizarLeido(c, archivo.nombre)).filter((c) => c !== null);
}

/**
 * Lo que devuelve el modelo se pasa por los mismos parseos que el resto: una
 * fecha en otro formato o un CUIT con guiones se arreglan acá, y un CUIT que no
 * cierra por dígito verificador se descarta en vez de viajar mal a la tabla.
 */
export function normalizarLeido(crudo: ChequeCrudo, origen: string): ChequeLeido | null {
  const numeroDe = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? v
      : typeof v === "string"
        ? parsearImporte(v)
        : null;
  const textoDe = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const nominal = numeroDe(crudo.nominal);
  const fecha = textoDe(crudo.fecha_pago);
  const cuitCrudo = textoDe(crudo.cuit_librador);

  const cheque: ChequeLeido = {
    nominal,
    fecha_pago: fecha ? parsearFecha(fecha) : null,
    cuit_librador: cuitCrudo ? buscarCuit(cuitCrudo) : null,
    banco: textoDe(crudo.banco),
    numero: textoDe(crudo.numero)?.replace(/\D/g, "") || null,
    nominal_en_letras: numeroDe(crudo.nominal_en_letras),
    origen,
  };

  // Sin importe ni fecha no hay nada que revisar: es ruido del documento.
  return cheque.nominal === null && cheque.fecha_pago === null ? null : cheque;
}
