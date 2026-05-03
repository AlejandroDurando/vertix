"use client";

import { FormEvent, useState } from "react";
import { Input, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { postJson } from "@/lib/api-client";

export function ContactoForm() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);
    setError(null);
    setFieldError(undefined);

    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());

    const res = await postJson("/api/contacto", payload);

    setSubmitting(false);

    if (res.success) {
      setSuccess(true);
      form.reset();
    } else {
      setError(res.error);
      setFieldError(res.field);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          name="nombre"
          label="Nombre completo"
          required
          autoComplete="name"
          error={fieldError === "nombre" ? error ?? undefined : undefined}
        />
        <Input
          name="email"
          type="email"
          label="Email"
          required
          autoComplete="email"
          error={fieldError === "email" ? error ?? undefined : undefined}
        />
        <Input
          name="telefono"
          label="Teléfono"
          required
          autoComplete="tel"
          placeholder="+54 11 5555-5555"
          error={fieldError === "telefono" ? error ?? undefined : undefined}
        />
        <Input
          name="empresa"
          label="Empresa"
          autoComplete="organization"
          hint="Opcional"
          error={fieldError === "empresa" ? error ?? undefined : undefined}
        />
      </div>
      <Input
        name="asunto"
        label="Asunto"
        required
        error={fieldError === "asunto" ? error ?? undefined : undefined}
      />
      <Textarea
        name="mensaje"
        label="Mensaje"
        required
        error={fieldError === "mensaje" ? error ?? undefined : undefined}
      />

      {error && !fieldError && (
        <Alert tone="error" title="No pudimos enviar tu mensaje">
          {error}
        </Alert>
      )}
      {success && (
        <Alert tone="success" title="Mensaje enviado">
          Te vamos a contactar a la brevedad.
        </Alert>
      )}

      <div className="pt-2">
        <Button type="submit" loading={submitting}>
          Enviar mensaje
        </Button>
      </div>
    </form>
  );
}
