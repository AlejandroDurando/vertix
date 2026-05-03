import Link from "next/link";
import { Nav } from "@/components/Nav";

const cards = [
  {
    href: "/simulador",
    title: "Simulador",
    description: "Calculá la cuota o el descuento al instante.",
  },
  {
    href: "/precalificacion",
    title: "Pre-calificación",
    description: "Solicitá descuento de cheques o un préstamo.",
  },
  {
    href: "/contacto",
    title: "Contacto",
    description: "¿Tenés una consulta? Escribinos.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-20">
        <section className="max-w-2xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-vertix/50">
            Financiera privada
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-vertix md:text-6xl">
            Vertix
          </h1>
          <p className="mt-6 text-lg text-vertix/70 md:text-xl">
            Descuento de cheques y préstamos para personas y empresas argentinas.
            Simulá, precalificá y obtené una respuesta rápida.
          </p>
        </section>

        <section className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-vertix/10 bg-white p-6 transition hover:border-vertix/30 hover:shadow-sm"
            >
              <h2 className="text-lg font-semibold text-vertix">{card.title}</h2>
              <p className="mt-2 text-sm text-vertix/60">{card.description}</p>
              <span className="mt-4 inline-block text-sm font-semibold text-vertix transition group-hover:translate-x-0.5">
                Ir →
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
