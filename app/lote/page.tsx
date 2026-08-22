import { Nav } from "@/components/Nav";
import { LoteForm } from "@/components/forms/LoteForm";

/**
 * Cotización de una tanda de cheques.
 *
 * Herramienta operativa del equipo: no está enlazada desde el menú y va como
 * no indexable, igual que `/legajos`. Cuando esa página lleve contraseña, esta
 * va en el mismo lote.
 *
 * Usa un ancho mayor que el resto del sitio porque la tabla no entra en el
 * `PageShell` de tres columnas.
 */
export const metadata = {
  title: "Cotización en lote — Vertix",
  robots: { index: false, follow: false },
};

export default function LotePage() {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8">
          <p className="mb-2 inline-block rounded-full bg-vertix/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-vertix">
            Uso interno
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-vertix md:text-4xl">
            Cotización en lote
          </h1>
          <p className="mt-2 max-w-2xl text-vertix/60">
            Cargá todos los cheques de un cliente y cotizalos de una sola vez. Los datos que no
            cambian entre cheques se completan arriba una única vez.
          </p>
        </div>
        <LoteForm />
      </main>
    </div>
  );
}
