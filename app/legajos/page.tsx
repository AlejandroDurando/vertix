import Link from "next/link";
import {
  listarLegajos,
  storageHabilitado,
  tokenDescarga,
  type ResumenLegajo,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Índice de todos los legajos recibidos: un solo lugar donde ver las altas y
 * las precalificaciones agrupadas por cliente, sin entrar fila por fila al CRM.
 *
 * No tiene login (decisión del cliente, 07/08/2026: por ahora son pruebas). Se
 * marca como no indexable para que no lo levante ningún buscador.
 */
export const metadata = {
  title: "Legajos — Vertix",
  robots: { index: false, follow: false },
};

const TRAMITES: Record<string, string> = {
  alta: "Altas de cuenta comitente",
  precalificacion: "Pre-calificaciones",
};

const pesar = (b: number) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const fmtFecha = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "sin fecha");

/**
 * La carpeta se guarda como `20123456786-Perez-Juan`. Se separa el CUIT del
 * nombre para mostrarlos por separado.
 */
function mostrarCliente(cliente: string | null): { cuit: string; nombre: string } {
  if (!cliente || cliente === "sin-identificar") return { cuit: "", nombre: "Sin identificar" };
  const m = /^(\d{11})-?(.*)$/.exec(cliente);
  if (!m) return { cuit: "", nombre: cliente.replace(/-/g, " ") };
  return { cuit: m[1], nombre: m[2].replace(/-/g, " ") || "Sin nombre" };
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-4xl px-6 py-16">
        <div className="rounded-xl border border-vertix/15 bg-vertix/5 p-6 text-vertix">
          {children}
        </div>
        <p className="mt-6 text-sm text-vertix/60">
          <Link href="/" className="underline">
            Volver al inicio
          </Link>
        </p>
      </main>
    </div>
  );
}

function FilaLegajo({ legajo }: { legajo: ResumenLegajo }) {
  const { cuit, nombre } = mostrarCliente(legajo.cliente);
  return (
    <a
      // Enlace relativo: el de `enlaceLegajo` es absoluto y depende de APP_URL,
      // que sirve para el CRM y los emails pero no hace falta acá.
      href={`/legajo?carpeta=${encodeURIComponent(legajo.carpeta)}&token=${tokenDescarga(
        legajo.carpeta
      )}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-vertix/15 p-4 transition hover:border-vertix/40 hover:bg-vertix/5"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-vertix">{nombre}</p>
        <p className="text-sm tabular-nums text-vertix/60">{cuit || "—"}</p>
      </div>
      <div className="text-sm text-vertix/60">
        <p className="tabular-nums">{fmtFecha(legajo.fecha)}</p>
        <p className="text-xs text-vertix/50">
          {legajo.documentos} doc{legajo.documentos === 1 ? "" : "s"} · {pesar(legajo.bytes)}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-vertix underline">Abrir</span>
    </a>
  );
}

export default async function LegajosPage() {
  if (!storageHabilitado()) {
    return <Aviso>El almacenamiento de documentos no está configurado.</Aviso>;
  }

  const legajos = await listarLegajos();
  if (legajos.length === 0) {
    return <Aviso>Todavía no se recibió documentación.</Aviso>;
  }

  const grupos = Object.entries(TRAMITES)
    .map(([clave, titulo]) => ({
      titulo,
      items: legajos.filter((l) => l.tramite === clave),
    }))
    .filter((g) => g.items.length > 0);

  const totalDocs = legajos.reduce((s, l) => s + l.documentos, 0);

  return (
    <div className="min-h-screen bg-white">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-vertix">Legajos recibidos</h1>
        <p className="mt-2 text-sm text-vertix/60">
          {legajos.length} legajo{legajos.length === 1 ? "" : "s"} · {totalDocs} documento
          {totalDocs === 1 ? "" : "s"}
        </p>

        {grupos.map((grupo) => (
          <section key={grupo.titulo} className="mt-10">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-vertix/60">
              {grupo.titulo} ({grupo.items.length})
            </h2>
            <div className="flex flex-col gap-2">
              {grupo.items.map((l) => (
                <FilaLegajo key={l.carpeta} legajo={l} />
              ))}
            </div>
          </section>
        ))}

        <p className="mt-10 text-xs text-vertix/50">
          Esta página lista documentación personal de los solicitantes. No la
          compartas fuera de Vertix.
        </p>
      </main>
    </div>
  );
}
