"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileInput, Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postForm } from "@/lib/api-client";
import { hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";
import { MIN_DIAS_HABILES } from "@/lib/validations";

type Servicio = "cheques" | "prestamos";
type TipoPrestamo = "personal" | "prendario";

const TIPO_PERSONA = [
  { value: "humana", label: "Persona humana" },
  { value: "empresa", label: "Empresa" },
];
const TIPO_PRESTAMO = [
  { value: "personal", label: "Personal" },
  { value: "prendario", label: "Prendario" },
];
const TIPO_INGRESO = [
  { value: "relacion_dependencia", label: "Relación de dependencia" },
  { value: "monotributo", label: "Monotributo" },
  { value: "empresa", label: "Empresa" },
];

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

export function PrecalificacionForm() {
  const [servicio, setServicio] = useState<Servicio>("cheques");
  const [tipoPrestamo, setTipoPrestamo] = useState<TipoPrestamo | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [fechaPago, setFechaPago] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  const minFechaPago = useMemo(
    () => toISODate(sumarDiasHabiles(hoy(), MIN_DIAS_HABILES)),
    []
  );
  const fechaMuyCercana = fechaPago !== "" && fechaPago < minFechaPago;

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
      setTipoPrestamo("");
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

      {servicio === "cheques" && (
        <Alert tone="info" title="¿Todavía no sos cliente de Vertix?">
          Para descontar cheques primero necesitás tener abierta tu cuenta comitente.
          Si aún no la tenés, completá el{" "}
          <Link href="/alta" className="font-semibold underline">
            formulario de alta
          </Link>{" "}
          o contactanos: una vez abierta la cuenta vas a poder descontar tus valores.
        </Alert>
      )}

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
              <Input
                name="empresa"
                label="Empresa"
                required
                autoComplete="organization"
                hint="Si sos persona física, escribí “Titular” o tu nombre."
                error={fe("empresa")}
              />
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
                name="fecha_pago"
                label="Fecha de pago del cheque"
                required
                type="date"
                min={minFechaPago}
                hint={`Mínimo ${MIN_DIAS_HABILES} días hábiles desde hoy.`}
                onChange={(e) => setFechaPago(e.target.value)}
                error={fe("fecha_pago")}
              />
              <Input name="banco_emisor" label="Banco emisor" required error={fe("banco_emisor")} />
              <Input
                name="cuit_librador"
                label="CUIT del librador del cheque"
                required
                inputMode="numeric"
                placeholder="Sólo números"
                error={fe("cuit_librador")}
              />
              <Input
                name="cuit_endosatario"
                label="CUIT del endosatario"
                required
                inputMode="numeric"
                placeholder="Sólo números"
                hint="A quién se le endosa (probablemente quien envía la solicitud). No puede coincidir con el librador."
                error={fe("cuit_endosatario")}
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
              <Select
                name="tipo_prestamo"
                label="Tipo de préstamo"
                required
                options={TIPO_PRESTAMO}
                placeholder="Seleccionar..."
                value={tipoPrestamo}
                onChange={(e) => setTipoPrestamo(e.target.value as TipoPrestamo)}
                error={fe("tipo_prestamo")}
              />
              <Input
                name="cuit_solicitante"
                label="CUIT de quien solicita el préstamo"
                required
                inputMode="numeric"
                placeholder="Sólo números"
                error={fe("cuit_solicitante")}
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

        {servicio === "cheques" && fechaMuyCercana && (
          <Alert tone="warning" title="Fecha de pago menor a 5 días hábiles">
            Por este medio no podemos tomar cheques con vencimiento menor a 5 días
            hábiles. <Link href="/contacto" className="font-semibold underline">Comunicate con nosotros</Link>{" "}
            y podemos ver otra manera de negociación.
          </Alert>
        )}

        {servicio === "prestamos" && (
          <div className="flex flex-col gap-4">
            <FileInput
              name="documentacion"
              label="Documentación de respaldo"
              required
              accept={ACCEPT}
              hint="Recibo de sueldo, balance, constancia de monotributo, etc. PDF o imagen, máx. 5MB."
              error={fe("documentacion")}
            />
            {tipoPrestamo === "prendario" && (
              <FileInput
                name="titulo_automotor"
                label="Título del automotor"
                required
                accept={ACCEPT}
                hint="Obligatorio para préstamos prendarios (se evalúan los años de vida útil). PDF o imagen, máx. 5MB."
                error={fe("titulo_automotor")}
              />
            )}
            <FileInput
              name="constancia_cuit"
              label="Constancia de CUIT (PJ) o CUIL/DNI (PF) — opcional"
              accept={ACCEPT}
              hint="Sumar este adjunto agiliza la evaluación. PDF o imagen, máx. 5MB."
              error={fe("constancia_cuit")}
            />
          </div>
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
