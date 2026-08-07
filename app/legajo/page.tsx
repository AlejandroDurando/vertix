import Link from "next/link";
import {
  enlaceDescarga,
  listarLegajo,
  storageHabilitado,
  tokenDescarga,
  tokenValido,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vista interna de un legajo: todos los documentos de un envío en una sola
 * página, con las fotos a la vista y la descarga completa en un zip.
 *
 * El enlace que queda en el CRM apunta acá. No hay login: el acceso depende del
 * token de la carpeta, igual que los documentos sueltos.
 */

const IMAGENES = ["jpg", "jpeg", "png", "webp"];
const esImagen = (nombre: string) =>
  IMAGENES.includes(nombre.split(".").pop()?.toLowerCase() ?? "");

const ETIQUETAS: Record<string, string> = {
  dni_frente: "DNI (frente)",
  dni_dorso: "DNI (dorso)",
  constancia_cbu: "Constancia de CBU",
  selfie_dni: "Selfie",
  conyuge_dni_frente: "DNI del cónyuge (frente)",
  conyuge_dni_dorso: "DNI del cónyuge (dorso)",
  constancia_regimen_simplificado: "Constancia del Régimen Simplificado",
  ddjj_actividad_licita: "DDJJ de actividad lícita firmada",
  nota_epyme_firmada: "Nota de Adhesión EPYME firmada",
  foto_aleatoria: "Foto aleatoria",
  servicio_titular: "Servicio a nombre del titular",
  constancia_ingresos: "Constancia de ingresos",
  estatuto: "Estatuto y modificaciones",
  registro_acciones: "Libro de Registro de Acciones",
  constancia_cuit: "Constancia de CUIT",
  dni_socios: "DNI de los socios",
  eecc: "Estados contables (CPCE)",
  ddjj: "DDJJ de IVA de los últimos 6 meses",
  documentacion: "Documentación de respaldo",
  titulo_automotor: "Título del automotor",
};

const pesar = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-xl border border-vertix/15 bg-vertix/5 p-6 text-vertix">
          {children}
        </div>
        <p className="mt-6 text-sm text-vertix/60">
          <Link href="/" className="underline">Volver al inicio</Link>
        </p>
      </main>
    </div>
  );
}

export default async function LegajoPage({
  searchParams,
}: {
  searchParams: { carpeta?: string; token?: string };
}) {
  if (!storageHabilitado()) {
    return <Aviso>El almacenamiento de documentos no está configurado.</Aviso>;
  }

  const carpeta = searchParams.carpeta ?? "";
  const token = searchParams.token ?? "";
  if (!carpeta || !token || !tokenValido(carpeta, token)) {
    return <Aviso>Enlace inválido o vencido. Pedí el enlace correcto desde el CRM.</Aviso>;
  }

  const docs = await listarLegajo(carpeta);
  if (docs.length === 0) {
    return <Aviso>Este legajo todavía no tiene documentos cargados.</Aviso>;
  }

  const [tramite, dia] = carpeta.split("/");
  const total = docs.reduce((s, d) => s + d.bytes, 0);
  const zip = `/api/adjuntos/zip?carpeta=${encodeURIComponent(carpeta)}&token=${tokenDescarga(carpeta)}`;

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vertix/60">
              {tramite === "alta" ? "Alta de cuenta comitente" : "Pre-calificación"}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-vertix">
              Documentación recibida
            </h1>
            <p className="mt-2 text-sm text-vertix/60">
              {docs.length} documento{docs.length === 1 ? "" : "s"} · {pesar(total)} · recibidos el{" "}
              {dia?.split("-").reverse().join("/")}
            </p>
          </div>
          <a
            href={zip}
            className="rounded-lg bg-vertix px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Descargar todo (.zip)
          </a>
        </div>

        <div className="flex flex-col gap-4">
          {docs.map((d) => {
            const url = enlaceDescarga(d.clave);
            return (
              <div
                key={d.clave}
                className="flex items-center gap-4 rounded-xl border border-vertix/15 p-4"
              >
                {esImagen(d.nombre) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={ETIQUETAS[d.campo] ?? d.campo}
                    className="h-20 w-20 shrink-0 rounded-lg border border-vertix/10 object-cover"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-vertix/10 bg-vertix/5 text-xs font-semibold text-vertix/60">
                    {d.nombre.split(".").pop()?.toUpperCase() ?? "DOC"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-vertix">
                    {ETIQUETAS[d.campo] ?? d.campo}
                  </p>
                  <p className="truncate text-sm text-vertix/60">{d.nombre}</p>
                  <p className="text-xs text-vertix/50">{pesar(d.bytes)}</p>
                </div>
                <a
                  href={url}
                  className="shrink-0 text-sm font-semibold text-vertix underline"
                >
                  Abrir
                </a>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-vertix/50">
          Este enlace da acceso a documentación personal del solicitante. No lo
          reenvíes fuera de Vertix.
        </p>
      </main>
    </div>
  );
}
