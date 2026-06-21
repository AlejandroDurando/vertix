import { AltaForm } from "@/components/forms/AltaForm";
import { PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Alta de cuenta — Vertix",
};

export default function AltaPage() {
  return (
    <PageShell
      title="Formulario de alta"
      description="Apertura de cuenta comitente. Completá tus datos y adjuntá la documentación requerida. Si tenés dudas sobre los requisitos, contactanos."
    >
      <AltaForm />
    </PageShell>
  );
}
