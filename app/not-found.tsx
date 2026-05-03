import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <h1 className="text-4xl font-bold text-vertix">404</h1>
      <p className="text-vertix/60">Página no encontrada.</p>
      <Link href="/" className="text-sm font-semibold text-vertix underline underline-offset-4">
        Volver al inicio
      </Link>
    </main>
  );
}
