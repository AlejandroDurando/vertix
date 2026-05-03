import { ContactoForm } from "@/components/forms/ContactoForm";
import { PageShell } from "@/components/PageShell";

export const metadata = {
  title: "Contacto — Vertix",
};

export default function ContactoPage() {
  return (
    <PageShell
      title="Contacto"
      description="Completá el formulario y te contactamos a la brevedad."
    >
      <ContactoForm />
    </PageShell>
  );
}
