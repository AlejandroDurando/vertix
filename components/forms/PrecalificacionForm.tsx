"use client";

import { FormEvent, useRef, useState } from "react";
import { FileInput, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postForm } from "@/lib/api-client";

type Servicio = "cheques" | "prestamos";

const TIPO_CHEQUE = [
  { value: "propio", label: "Propio" },
  { value: "tercero", label: "Tercero" },
];
const TIPO_PERSONA = [
  { value: "humana", label: "Persona humana" },
  { value: "empresa", label: "Empresa" },
];
const TIPO_INGRESO = [
  { value: "relacion_dependencia", label: "Relación de dependencia" },
  { value: "monotributo", label: "Monotributo" },
  { value: "empresa", label: "Empresa" },
];

export function PrecalificacionForm() {
  const [servicio, setServicio] = useState<Servicio>("cheques");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  function changeServicio(next: Servicio) {
    setServicio(next);
    setError(null);
    setFieldError(undefined);
    setSuccess(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);
    setError(null);
    setFieldError(undefined);

    const fd = new FormData(e.currentTarget);
    fd.set("servicio", servicio);

    const res = await postForm("/api/precalificacion", fd);
    setSubmitting(false);

    if (res.success) {
      setSuccess(true);
      formRef.current?.reset();
    } else {
      setError(res.error);
      setFieldError(res.field);
    }
  }

  const fe = (name: string) => (fieldError === name ? error ?? undefined : undefined);

  return (
    <div className="flex flex-col gap-6">
      <Tabs<Servicio>
        tabs={[
          { value: "cheques", label: "Descuento de cheques" },
          { value: "prestamos", label: "Préstamos" },
        ]}
        active={servicio}
        onChange={changeServicio}
      />

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        encType="multipart/form-data"
        noValidate
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input name="nombre" label="Nombre completo" required autoComplete="name" error={fe("nombre")} />
          <Input name="email" type="email" label="Email" required autoComplete="email" error={fe("email")} />
          <Input name="telefono" label="Teléfono" required autoComplete="tel" error={fe("telefono")} />

          {servicio === "cheques" ? (
            <>
              <Input name="empresa" label="Empresa" required autoComplete="organization" error={fe("empresa")} />
              <Input
                name="monto_cheque"
                label="Monto del cheque (ARS)"
                required
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                error={fe("monto_cheque")}
              />
              <Input
                name="fecha_vencimiento"
                label="Fecha de vencimiento"
                required
                type="date"
                error={fe("fecha_vencimiento")}
              />
              <Input name="banco_emisor" label="Banco emisor" required error={fe("banco_emisor")} />
              <Select
                name="tipo_cheque"
                label="Tipo de cheque"
                required
                options={TIPO_CHEQUE}
                placeholder="Seleccionar..."
                defaultValue=""
                error={fe("tipo_cheque")}
              />
            </>
          ) : (
            <>
              <Select
                name="tipo_persona"
                label="Tipo de persona"
                required
                options={TIPO_PERSONA}
                placeholder="Seleccionar..."
                defaultValue=""
                error={fe("tipo_persona")}
              />
              <Input
                name="monto_solicitado"
                label="Monto solicitado (ARS)"
                required
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                error={fe("monto_solicitado")}
              />
              <Input
                name="plazo_meses"
                label="Plazo (meses)"
                required
                type="number"
                inputMode="numeric"
                min="1"
                max="120"
                error={fe("plazo_meses")}
              />
              <Select
                name="tipo_ingreso"
                label="Tipo de ingreso"
                required
                options={TIPO_INGRESO}
                placeholder="Seleccionar..."
                defaultValue=""
                error={fe("tipo_ingreso")}
              />
            </>
          )}
        </div>

        {servicio === "prestamos" && (
          <FileInput
            name="archivo"
            label="Documentación (PDF o imagen)"
            required
            accept="application/pdf,image/jpeg,image/png,image/webp"
            hint="Recibo de sueldo, balance, monotributo, etc. Máximo 5MB."
            error={fe("archivo")}
          />
        )}

        {error && !fieldError && (
          <Alert tone="error" title="No pudimos enviar la solicitud">
            {error}
          </Alert>
        )}
        {success && (
          <Alert tone="success" title="Solicitud recibida">
            Vamos a evaluar tu pre-calificación y te contactamos a la brevedad.
          </Alert>
        )}

        <div className="pt-2">
          <Button type="submit" loading={submitting}>
            Enviar solicitud
          </Button>
        </div>
      </form>
    </div>
  );
}
