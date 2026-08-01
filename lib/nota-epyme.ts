/**
 * Nota de Adhesión a EPYME pre-llenada con los datos del formulario. El usuario
 * la descarga, la firma y la vuelve a subir como adjunto.
 *
 * Se genera como .docx (no como página para imprimir) porque el navegador le
 * agrega encabezado y pie a todo lo que manda a la impresora — la fecha, el
 * "about:blank" y el número de página — y eso no se puede sacar desde la
 * página. Con el archivo de Word el documento sale siempre limpio.
 * Decisión del cliente del 31/07/2026 ("opción C").
 *
 * Basado en los modelos de AdCap y Sailing.
 */

import {
  AlignmentType,
  Document,
  Packer,
  Paragraph,
  TabStopType,
  TextRun,
} from "docx";

export type NotaEpymeInput = {
  alyc: "adcap" | "sailing";
  esPersonaJuridica: boolean;
  razonSocial?: string;
  caracterDomicilio: string; // domicilio del declarante
  // Usuario Administrador designado
  adminNombre: string;
  adminEmail: string;
  adminDni: string;
  adminCuit: string;
  adminTelefono: string;
  adminDomicilioLegal: string;
  adminCargo: string;
  // Firma
  firmante: string; // apellido y nombre / razón social
  firmanteCuit: string;
  firmanteCargo: string;
};

const ALYC_NOMBRE: Record<NotaEpymeInput["alyc"], string> = {
  adcap: "AdCap",
  sailing: "Sailing Inversiones S.A.",
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Espacio a completar a mano cuando el dato no vino del formulario. */
const PENDIENTE = "XXXX";

const valor = (v: string | undefined) => (v && v.trim() ? v.trim() : PENDIENTE);

export function nombreArchivoNota(input: NotaEpymeInput): string {
  const quien = input.esPersonaJuridica ? input.razonSocial : input.firmante;
  const limpio = (quien ?? "vertix")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 50);
  return `nota-adhesion-epyme-${limpio || "vertix"}.docx`;
}

const parrafo = (texto: string, opts?: { negrita?: boolean; espacioDespues?: number }) =>
  new Paragraph({
    spacing: { after: opts?.espacioDespues ?? 200, line: 300 },
    children: [new TextRun({ text: texto, bold: opts?.negrita, font: "Calibri", size: 22 })],
  });

const dato = (etiqueta: string, valorTexto: string) =>
  new Paragraph({
    spacing: { after: 80, line: 300 },
    tabStops: [{ type: TabStopType.LEFT, position: 500 }],
    children: [
      new TextRun({ text: "• ", font: "Calibri", size: 22 }),
      new TextRun({ text: `${etiqueta}: `, font: "Calibri", size: 22 }),
      new TextRun({ text: valorTexto, font: "Calibri", size: 22, bold: true }),
    ],
  });

/** Arma el documento Word y lo devuelve listo para descargar. */
export async function notaEpymeDocx(input: NotaEpymeInput): Promise<Buffer> {
  const now = new Date();
  const fecha = `Buenos Aires, ${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}.`;
  const destinatario = ALYC_NOMBRE[input.alyc];

  // El carácter de quien firma no siempre es "apoderado": puede ser socio
  // gerente, presidente, director o administrador titular.
  const caracter = input.esPersonaJuridica
    ? `${valor(input.firmanteCargo)} de ${valor(input.razonSocial)}`
    : "titular";

  const encabezado = input.esPersonaJuridica
    ? valor(input.razonSocial)
    : valor(input.firmante);

  const doc = new Document({
    creator: "Vertix",
    title: `Nota de Adhesión EPYME — ${destinatario}`,
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children: [
          parrafo(encabezado, { negrita: true }),
          parrafo(fecha),
          parrafo("Sres:"),
          parrafo(destinatario),
          parrafo("Presente", { espacioDespues: 300 }),
          parrafo(
            `Mediante la presente me dirijo a Ud. en mi carácter de ${caracter}, con domicilio en ` +
              `${valor(input.caracterDomicilio)}, en relación con el trámite de "Adhesión a EPYME", ` +
              "a los fines de informarle los datos correspondientes a la persona designada para " +
              "operar como usuario Administrador en el sitio web:"
          ),
          dato("NOMBRE Y APELLIDO", valor(input.adminNombre)),
          dato("DIRECCIÓN DE CORREO ELECTRÓNICO", valor(input.adminEmail)),
          dato("DNI O PASAPORTE", valor(input.adminDni)),
          dato("CUIT/CUIL", valor(input.adminCuit)),
          dato("TELÉFONO", valor(input.adminTelefono)),
          dato("DOMICILIO LEGAL", valor(input.adminDomicilioLegal)),
          dato("CARGO", valor(input.adminCargo)),
          new Paragraph({ spacing: { after: 200 } }),
          parrafo(
            "Nos comprometemos a comunicar en forma inmediata, en caso de ocurrir la remoción del " +
              "Administrador, y, en su caso, la designación de sus reemplazantes, y/o toda " +
              "modificación de los datos oportunamente informados."
          ),
          parrafo(
            "Declaramos conocer y aceptar la facultad otorgada a él/los usuarios Administradores " +
              "para dar de alta en EPYME, a nuevos usuarios Administradores y/o Operadores para " +
              "actuar en representación de la EMPRESA y bajo nuestra exclusiva responsabilidad."
          ),
          parrafo(
            "Por último, hacemos saber que hemos adherido a los Términos y Condiciones de Uso de EPYME.",
            { espacioDespues: 1200 }
          ),
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 60 },
            children: [new TextRun({ text: "___________________________", font: "Calibri", size: 22 })],
          }),
          parrafo(valor(input.firmante), { espacioDespues: 60 }),
          parrafo(`CUIT/CUIL: ${valor(input.firmanteCuit)}`, { espacioDespues: 60 }),
          parrafo(valor(input.firmanteCargo)),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
