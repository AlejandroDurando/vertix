"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FileInput, Input, NumberInput, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postForm } from "@/lib/api-client";
import {
  MAX_TOTAL_BYTES,
  comprimirAdjuntos,
  mensajeExcedido,
  subirAdjuntos,
} from "@/lib/adjuntos-client";
import { hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";
import {
  MIN_DIAS_HABILES,
  MODALIDAD_OPCIONES,
  PLAZO_OPCIONES,
  PORCENTAJE_ACEPTADO_FCE,
  fechaPagoMinima,
  instrumentoSoloComitente,
  instrumentoSoloDirecto,
  modalidadRequiereMinDias,
  valorAceptadoSugerido,
} from "@/lib/validations";
import {
  MSG_ABRIR_CUENTA,
  TELEFONO,
  TELEFONO_URL,
  WHATSAPP_URL,
  whatsappCon,
} from "@/lib/contacto";
import type { InstrumentoCheque, ModalidadCheque } from "@/types";

type Servicio = "cheques" | "prestamos";
type TipoPrestamo = "personal" | "prendario";

const INSTRUMENTO = [
  { value: "cheque", label: "Cheque" },
  { value: "echeq", label: "Echeq" },
  { value: "fce", label: "FCE (Factura de Crédito Electrónica)" },
];
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
  const [preAprobado, setPreAprobado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [fechaPago, setFechaPago] = useState("");
  const [instrumento, setInstrumento] = useState<InstrumentoCheque>("cheque");
  const [modalidad, setModalidad] = useState<ModalidadCheque>("directo");
  // En la FCE se negocia el valor aceptado: se precarga el 80% del total y se
  // corrige si el comprador aceptó otro importe (igual que en el simulador).
  const [montoTotal, setMontoTotal] = useState("");
  const [aceptado, setAceptado] = useState("");
  const [aceptadoEditado, setAceptadoEditado] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // El cheque físico no se negocia en el mercado (sólo sin comitente) y la FCE
  // sólo se negocia ahí. El echeq admite las dos vías.
  const soloDirecto = instrumentoSoloDirecto(instrumento);
  const soloComitente = instrumentoSoloComitente(instrumento);
  const modalidadEfectiva: ModalidadCheque = soloDirecto
    ? "directo"
    : soloComitente
      ? "comitente"
      : modalidad;

  // Los 5 días hábiles los exige el mercado de capitales: rigen sólo con
  // cuenta comitente, igual que en el simulador.
  const exigeMinDias = modalidadRequiereMinDias(modalidadEfectiva);
  const minFechaPago = useMemo(() => toISODate(fechaPagoMinima()), []);

  const esFce = instrumento === "fce";
  const aceptadoSugerido = useMemo(() => {
    const n = Number(montoTotal);
    return Number.isFinite(n) && n > 0 ? String(valorAceptadoSugerido(n)) : "";
  }, [montoTotal]);
  const valorAceptado = aceptadoEditado ? aceptado : aceptadoSugerido;
  const fechaMuyCercana = exigeMinDias && fechaPago !== "" && fechaPago < minFechaPago;

  function changeServicio(next: Servicio) {
    setServicio(next);
    setError(null);
    setFieldError(undefined);
    setSuccess(false);
    setPreAprobado(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);
    setError(null);
    setFieldError(undefined);

    const fd = new FormData(e.currentTarget);
    fd.set("servicio", servicio);

    const resumen = await comprimirAdjuntos(fd);

    const subida = await subirAdjuntos(fd, "precalificacion");
    if (typeof subida === "object") {
      setError(subida.error);
      setSubmitting(false);
      return;
    }
    if (subida === "sin-storage" && resumen.total > MAX_TOTAL_BYTES) {
      setError(mensajeExcedido(resumen));
      setSubmitting(false);
      return;
    }

    const res = await postForm<{ pre_aprobado?: boolean }>("/api/precalificacion", fd);
    setSubmitting(false);

    if (res.success) {
      setSuccess(true);
      setPreAprobado(Boolean(res.data?.pre_aprobado));
      setTipoPrestamo("");
      // Los campos controlados no los limpia form.reset().
      setMontoTotal("");
      setAceptado("");
      setAceptadoEditado(false);
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
          o{" "}
          <a
            href={whatsappCon(MSG_ABRIR_CUENTA)}
            className="font-semibold underline"
            target="_blank"
            rel="noreferrer"
          >
            contactanos
          </a>
          : una vez abierta la cuenta vas a poder descontar tus valores.
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
              <Select
                name="instrumento"
                label="Instrumento"
                required
                options={INSTRUMENTO}
                placeholder="Seleccionar..."
                value={instrumento}
                onChange={(e) => setInstrumento(e.target.value as InstrumentoCheque)}
                hint="El cheque físico se negocia sin cuenta comitente; el echeq y la FCE, en el mercado de capitales."
                error={fe("instrumento")}
              />
              <Select
                name="modalidad"
                label="Modalidad"
                required
                options={
                  soloDirecto
                    ? [MODALIDAD_OPCIONES[0]]
                    : soloComitente
                      ? [MODALIDAD_OPCIONES[1]]
                      : MODALIDAD_OPCIONES
                }
                placeholder="Seleccionar..."
                value={modalidadEfectiva}
                onChange={(e) => setModalidad(e.target.value as ModalidadCheque)}
                hint={
                  soloDirecto
                    ? "El cheque físico se opera únicamente sin cuenta comitente: en el mercado de capitales sólo se negocian echeq y FCE."
                    : soloComitente
                      ? "La FCE se negocia únicamente en el mercado de capitales, con cuenta comitente."
                      : "Con cuenta comitente la tasa es más baja."
                }
                error={fe("modalidad")}
              />
              <Input
                name="monto_cheque"
                label={esFce ? "Valor total de la factura (ARS)" : "Monto del cheque (ARS)"}
                required
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                value={montoTotal}
                onChange={(e) => setMontoTotal(e.target.value)}
                error={fe("monto_cheque")}
              />
              {esFce && (
                <Input
                  name="monto_aceptado"
                  label="Valor aceptado (ARS)"
                  required
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  value={valorAceptado}
                  onChange={(e) => {
                    setAceptadoEditado(true);
                    setAceptado(e.target.value);
                  }}
                  hint={`Es lo que se negocia. Se calcula como el ${PORCENTAJE_ACEPTADO_FCE}% del total; si el saldo aceptado es otro, colocá el correspondiente.`}
                  error={fe("monto_aceptado")}
                />
              )}
              <Input
                name="fecha_pago"
                label="Fecha de pago del cheque"
                required
                type="date"
                min={exigeMinDias ? minFechaPago : undefined}
                hint={
                  exigeMinDias
                    ? `Mínimo ${MIN_DIAS_HABILES} días hábiles contando hoy (lo exige el mercado de capitales).`
                    : undefined
                }
                onChange={(e) => setFechaPago(e.target.value)}
                error={fe("fecha_pago")}
              />
              <Input name="banco_emisor" label="Banco emisor" required error={fe("banco_emisor")} />
              <NumberInput
                name="cuit_librador"
                label="CUIT del librador del cheque"
                required
                maxDigits={11}
                placeholder="11 números"
                error={fe("cuit_librador")}
              />
              <NumberInput
                name="cuit_endosatario"
                label="CUIT del endosatario"
                required
                maxDigits={11}
                placeholder="11 números"
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
              <NumberInput
                name="cuit_solicitante"
                label="CUIT de quien solicita el préstamo"
                required
                maxDigits={11}
                placeholder="11 números"
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
              <Select
                name="plazo_meses"
                label="Plazo"
                required
                options={PLAZO_OPCIONES}
                placeholder="Seleccionar..."
                defaultValue=""
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
            Con cuenta comitente no podemos tomar valores con vencimiento menor a 5
            días hábiles: lo exige el mercado de capitales. Probá con{" "}
            <strong>Sin cuenta comitente en el mercado de capitales</strong> o llamanos al{" "}
            <a href={TELEFONO_URL} className="font-semibold underline">{TELEFONO}</a>{" "}
            (<a href={WHATSAPP_URL} className="font-semibold underline" target="_blank" rel="noreferrer">WhatsApp</a>){" "}
            y vemos otra manera de negociación.
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
              label="Constancia de CUIT (PJ) o CUIL/DNI (PF)"
              required
              accept={ACCEPT}
              hint="PDF o imagen, máx. 5MB."
              error={fe("constancia_cuit")}
            />
          </div>
        )}

        {error && !fieldError && (
          <Alert tone="error" title="No pudimos enviar la solicitud">
            {error}
          </Alert>
        )}
        {success && preAprobado ? (
          <Alert tone="success" title="¡PRE APROBADO!">
            Tu solicitud pasó la verificación crediticia en el BCRA. Queda sujeta a
            la revisión de la documentación y al análisis final, pero ya podemos
            avanzar: te contactamos a la brevedad para cerrar los detalles.
          </Alert>
        ) : (
          success && (
            <Alert tone="success" title="Solicitud recibida">
              Vamos a evaluar tu pre-calificación y te contactamos a la brevedad.
            </Alert>
          )
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
