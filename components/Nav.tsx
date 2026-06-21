import Link from "next/link";

export function Nav() {
  return (
    <header className="border-b border-vertix/10 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-bold tracking-tight text-vertix">
          Vertix
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/simulador" className="text-vertix/70 hover:text-vertix">
            Simulador
          </Link>
          <Link href="/precalificacion" className="text-vertix/70 hover:text-vertix">
            Pre-calificación
          </Link>
          <Link href="/alta" className="text-vertix/70 hover:text-vertix">
            Alta
          </Link>
          <Link
            href="/contacto"
            className="rounded-lg bg-vertix px-4 py-2 font-semibold text-white hover:bg-vertix-dark"
          >
            Contacto
          </Link>
        </nav>
      </div>
    </header>
  );
}
