import { Nav } from "./Nav";

type Props = {
  title: string;
  description?: string;
  children: React.ReactNode;
};

export function PageShell({ title, description, children }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <Nav />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-vertix md:text-4xl">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-vertix/60">{description}</p>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
