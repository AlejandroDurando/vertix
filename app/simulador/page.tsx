import { SimuladorForm } from "@/components/forms/SimuladorForm";
import { PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Simulador — Vertix",
};

export default function SimuladorPage() {
  return (
    <PageShell
      title="Simulador"
      description="Estimá tu cuota o el descuento sobre un cheque. Resultado orientativo."
    >
      <SimuladorForm />
    </PageShell>
  );
}
