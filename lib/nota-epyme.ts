/**
 * Genera el HTML de la "Nota de Adhesión a EPYME" pre-llenada, a partir de los
 * datos del usuario Administrador. El usuario la descarga/imprime, la firma y la
 * vuelve a subir como adjunto. Basado en los modelos de AdCap y Sailing.
 */

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

function esc(v: string): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function notaEpymeHtml(input: NotaEpymeInput): string {
  const now = new Date();
  const fecha = `Buenos Aires, ${now.getDate()} de ${MESES[now.getMonth()]} de ${now.getFullYear()}.`;
  const destinatario = ALYC_NOMBRE[input.alyc];
  const caracter = input.esPersonaJuridica
    ? `apoderado de ${esc(input.razonSocial ?? "")}`
    : "titular";

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Nota de Adhesión EPYME — ${esc(destinatario)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 720px; margin: 40px auto; line-height: 1.6; padding: 0 24px; }
  h1 { font-size: 16px; letter-spacing: .04em; }
  ul { list-style: none; padding: 0; }
  li { margin: 4px 0; }
  .firma { margin-top: 64px; }
  .linea { border-top: 1px solid #333; width: 280px; padding-top: 6px; }
  @media print { body { margin: 0; } button { display:none; } }
</style></head>
<body>
  <p><strong>${input.esPersonaJuridica ? esc(input.razonSocial ?? "") : esc(input.firmante)}</strong></p>
  <p>${fecha}</p>
  <p>Sres:<br/>${esc(destinatario)}<br/>Presente</p>
  <p>Mediante la presente me dirijo a Ud. en mi carácter de ${caracter}, con domicilio en
  ${esc(input.caracterDomicilio)}, en relación con el trámite de "Adhesión a EPYME", a los fines de
  informarle los datos correspondientes a la persona designada para operar como usuario Administrador
  en el sitio web:</p>
  <ul>
    <li>• NOMBRE y APELLIDO: ${esc(input.adminNombre)}</li>
    <li>• DIRECCIÓN DE CORREO ELECTRÓNICO: ${esc(input.adminEmail)}</li>
    <li>• DNI O PASAPORTE: ${esc(input.adminDni)}</li>
    <li>• CUIT/CUIL: ${esc(input.adminCuit)}</li>
    <li>• TELÉFONO: ${esc(input.adminTelefono)}</li>
    <li>• DOMICILIO LEGAL: ${esc(input.adminDomicilioLegal)}</li>
    <li>• CARGO: ${esc(input.adminCargo)}</li>
  </ul>
  <p>Nos comprometemos a comunicar en forma inmediata, en caso de ocurrir la remoción del Administrador,
  y, en su caso, la designación de sus reemplazantes, y/o toda modificación de los datos oportunamente
  informados.</p>
  <p>Declaramos conocer y aceptar la facultad otorgada a él/los usuarios Administradores para dar de alta
  en EPYME, a nuevos usuarios Administradores y/o Operadores para actuar en representación de la EMPRESA
  y bajo nuestra exclusiva responsabilidad.</p>
  <p>Por último, hacemos saber que hemos adherido a los Términos y Condiciones de Uso de EPYME.</p>
  <div class="firma">
    <div class="linea">
      ${esc(input.firmante)}<br/>
      CUIT/CUIL: ${esc(input.firmanteCuit)}<br/>
      ${esc(input.firmanteCargo)}
    </div>
  </div>
  <button onclick="window.print()" style="margin-top:40px;padding:10px 20px;font-size:14px;cursor:pointer">Imprimir / Guardar PDF</button>
</body></html>`;
}
