import { PrecalificacionForm } from "@/components/forms/PrecalificacionForm";
import { PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Pre-calificación — Vertix",
};

export default function PrecalificacionPage() {
  return (
    <PageShell
      title="Pre-calificación"
      description="Solicitá descuento de cheques o un préstamo. Te respondemos a la brevedad."
    >
      <PrecalificacionForm />
    </PageShell>
  );
}
