import { NextRequest } from "next/server";
import { parseAlta } from "@/lib/validations";
import { fail, ok } from "@/lib/api-response";
import { checkRateLimit, getClientIp, maybeCleanup } from "@/lib/rate-limit";
import { readUploads } from "@/lib/uploads";
import { appendAlta } from "@/lib/sheets-crm";
import { emailAlta, emailConfirmacionAlta } from "@/lib/email";
import {
  carpetaDe,
  enlaceDescarga,
  enlaceLegajo,
  marcarLegajoCompleto,
} from "@/lib/storage";
import { hoy, toISODate } from "@/lib/fechas";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Adjuntos posibles (se valida cuáles son obligatorios según tipo/condiciones).
const FILE_FIELDS = [
  // Persona física
  "dni_frente",
  "dni_dorso",
  "constancia_cbu",
  "conyuge_dni_frente",
  "conyuge_dni_dorso",
  "constancia_regimen_simplificado",
  "ddjj_actividad_licita",
  "nota_epyme_firmada",
  // Persona física — requisitos adicionales de Sailing
  "selfie_dni",
  "foto_aleatoria",
  "servicio_titular",
  "constancia_ingresos",
  // Persona jurídica
  "estatuto",
  "registro_acciones",
  "constancia_cuit",
  "dni_socios",
  "eecc",
  "ddjj",
];

const LABELS: Record<string, string> = {
  dni_frente: "DNI (frente)",
  dni_dorso: "DNI (dorso)",
  constancia_cbu: "Constancia de CBU",
  conyuge_dni_frente: "DNI del cónyuge (frente)",
  conyuge_dni_dorso: "DNI del cónyuge (dorso)",
  constancia_regimen_simplificado:
    "Constancia de adhesión al Régimen Simplificado de Ganancias",
  ddjj_actividad_licita: "DDJJ de actividad lícita firmada",
  nota_epyme_firmada: "Nota de Adhesión EPYME firmada",
  selfie_dni: "Selfie",
  foto_aleatoria: "Foto aleatoria (ej. palma derecha levantada)",
  servicio_titular: "Servicio a nombre del titular",
  constancia_ingresos: "Últimos 3 recibos de sueldo o constancia de monotributo",
  estatuto: "Estatuto y modificaciones",
  registro_acciones: "Libro de Registro de Acciones",
  constancia_cuit: "Constancia de CUIT",
  dni_socios: "DNI de los socios",
  eecc: "Estados contables certificados por el CPCE",
  ddjj: "DDJJ de IVA de los últimos 6 meses con acuses de presentación",
};

export async function POST(req: NextRequest) {
  maybeCleanup();
  const ip = getClientIp(req);
  const rl = checkRateLimit(`alta:${ip}`);
  if (!rl.ok) {
    return fail("Demasiadas solicitudes, intentá nuevamente en un minuto.", 429);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return fail("Content-Type no soportado (se espera multipart/form-data)", 400);
  }

  const form = await req.formData();
  const parsed = await readUploads(form, { fileFields: FILE_FIELDS });
  if ("error" in parsed) return fail(parsed.error, 400);

  const validated = parseAlta(parsed.data);
  if (!validated.success) {
    return fail(validated.message, 400, validated.field);
  }

  const data = validated.data;
  const files = parsed.files;
  const subidos = parsed.subidos;
  // Un documento cuenta como presente venga por el formulario o ya subido al
  // bucket, así el chequeo de obligatorios no depende del camino que se usó.
  const presente = (campo: string) => Boolean(files[campo] || subidos[campo]);

  // Adjuntos obligatorios según tipo y condiciones.
  const required: string[] = [];
  if (data.tipo === "fisica") {
    // La selfie con DNI se pide en toda alta de persona física, no sólo en
    // Sailing (pedido del cliente, 25/07/2026).
    required.push(
      "dni_frente",
      "dni_dorso",
      "constancia_cbu",
      "selfie_dni",
      "nota_epyme_firmada"
    );
    if (data.estado_civil === "casado") {
      required.push("conyuge_dni_frente", "conyuge_dni_dorso");
    }
    // Régimen Simplificado de DDJJ de Ganancias: si adhiere, van la constancia
    // de adhesión y la DDJJ de actividad lícita firmada (pedido del cliente,
    // 06/08/2026). Sólo en persona física: para PJ no fue solicitada.
    if (data.regimen_simplificado_ganancias === "si") {
      required.push("constancia_regimen_simplificado", "ddjj_actividad_licita");
    }
    // Requisitos adicionales de Sailing para personas físicas.
    if (data.alyc === "sailing") {
      required.push("foto_aleatoria");
      // Servicio a nombre del titular sólo si el domicilio del DNI no es el actual.
      if (data.domicilio_dni_actual === "no") {
        required.push("servicio_titular");
      }
      // Los recibos de sueldo/monotributo NO son bloqueantes: si no los tiene,
      // Sailing hace una búsqueda interna y asigna cupo según NSE.
    }
  } else {
    required.push(
      "estatuto",
      "constancia_cbu",
      "constancia_cuit",
      "dni_socios",
      "nota_epyme_firmada"
    );
    // El respaldo contable depende de si la empresa tiene el último balance
    // certificado por el CPCE; si no lo tiene, van las DDJJ de IVA.
    required.push(data.tiene_eecc === "si" ? "eecc" : "ddjj");
    if (data.tipo_societario === "sa" || data.tipo_societario === "sas") {
      required.push("registro_acciones");
    }
    // El DNI del cónyuge del firmante se adjunta igual que en persona física.
    if (data.referente_estado_civil === "casado") {
      required.push("conyuge_dni_frente", "conyuge_dni_dorso");
    }
  }

  for (const campo of required) {
    if (!presente(campo)) {
      return fail(`Falta adjuntar: ${LABELS[campo] ?? campo}.`, 400, campo);
    }
  }

  const sentAt = new Date().toISOString();
  const adjuntos = Object.entries(files).map(([campo, f]) => ({ campo, ...f }));
  const enlaces = Object.entries(subidos).map(([campo, ref]) => ({
    etiqueta: LABELS[campo] ?? campo,
    nombre: ref.nombre,
    url: enlaceDescarga(ref.clave),
  }));

  // En la planilla queda UN enlace por fila, al legajo completo: abrirlo de a
  // un documento desde una celda era impracticable. Si los archivos viajaron
  // por email, sólo queda el nombre del campo (no hay copia recuperable).
  const carpeta = Object.values(subidos)[0]
    ? carpetaDe(Object.values(subidos)[0].clave)
    : "";
  const paraSheets = carpeta ? [enlaceLegajo(carpeta)] : adjuntos.map((a) => a.campo);

  // Todo awaited: en serverless los fire-and-forget se cancelan al responder.
  const [sheetsRes, emailRes] = await Promise.all([
    appendAlta(data, sentAt, paraSheets),
    emailAlta(
      data,
      adjuntos.map((a) => ({ filename: `${a.campo}-${a.nombre}`, content: a.base64 })),
      enlaces
    ),
  ]);

  // El alta tiene que quedar registrada en al menos un destino.
  if (!sheetsRes.ok && !emailRes.ok) {
    logger.error("alta", "No se pudo registrar el alta en ningún destino", {
      sheets: sheetsRes.reason,
      email: emailRes.reason,
    });
    return fail(
      "No pudimos registrar tu solicitud en este momento. Intentá nuevamente en unos minutos.",
      503
    );
  }

  // Recién ahora la carpeta es un legajo: hasta acá podía ser un intento
  // abandonado o un reenvío. Es lo que hace que aparezca en /legajos.
  await marcarLegajoCompleto(carpeta, {
    tramite: "alta",
    nombre:
      data.tipo === "fisica" ? `${data.apellido} ${data.nombre}` : data.razon_social,
    cuit: data.cuit,
    email: data.email,
    recibido_el: toISODate(hoy()),
  });

  // Confirmación al solicitante (best-effort, pero awaited por serverless).
  const confirmacion = await emailConfirmacionAlta(data.email, {
    nombre: data.tipo === "fisica" ? `${data.nombre} ${data.apellido}` : data.razon_social,
    tipo: data.tipo,
    alyc: data.alyc,
    // Al solicitante se le lista lo recibido, nunca los enlaces internos.
    adjuntos: [
      ...adjuntos.map((a) => LABELS[a.campo] ?? a.campo),
      ...Object.keys(subidos).map((campo) => LABELS[campo] ?? campo),
    ],
  }).catch(() => null);

  logger.info("alta", "Alta recibida", {
    tipo: data.tipo,
    alyc: data.alyc,
    adjuntos: [...adjuntos.map((a) => a.campo), ...Object.keys(subidos)],
    en_bucket: enlaces.length,
    confirmacion_enviada: confirmacion?.ok ?? false,
  });

  return ok({
    recibido: true,
    tipo: data.tipo,
    alyc: data.alyc,
    confirmacion_enviada: confirmacion?.ok ?? false,
  });
}
