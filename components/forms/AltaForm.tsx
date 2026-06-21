"use client";

import { FormEvent, useRef, useState } from "react";
import { FileInput, Input, Select, Textarea } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postForm } from "@/lib/api-client";
import { notaEpymeHtml } from "@/lib/nota-epyme";

type TipoAlta = "fisica" | "juridica";
type Alyc = "adcap" | "sailing";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const SI_NO = [
  { value: "no", label: "No" },
  { value: "si", label: "Sí" },
];
const ALYC = [
  { value: "adcap", label: "AdCap" },
  { value: "sailing", label: "Sailing Inversiones" },
];
const ESTADO_CIVIL = [
  { value: "soltero", label: "Soltero/a" },
  { value: "casado", label: "Casado/a" },
  { value: "divorciado", label: "Divorciado/a" },
  { value: "viudo", label: "Viudo/a" },
  { value: "union", label: "Unión convivencial" },
];
const TIPO_SOCIETARIO = [
  { value: "sa", label: "S.A." },
  { value: "sas", label: "S.A.S." },
  { value: "srl", label: "S.R.L." },
  { value: "otra", label: "Otra" },
];

function field(fd: FormData, name: string): string {
  return String(fd.get(name) ?? "").trim();
}

export function AltaForm() {
  const [tipo, setTipo] = useState<TipoAlta>("fisica");
  const [alyc, setAlyc] = useState<Alyc | "">("");
  const [estadoCivil, setEstadoCivil] = useState("");
  const [refEstadoCivil, setRefEstadoCivil] = useState("");
  const [tipoSocietario, setTipoSocietario] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  function resetConditionals() {
    setEstadoCivil("");
    setRefEstadoCivil("");
    setTipoSocietario("");
  }

  function changeTipo(next: TipoAlta) {
    setTipo(next);
    setError(null);
    setFieldError(undefined);
    setSuccess(false);
    resetConditionals();
    formRef.current?.reset();
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);
    setError(null);
    setFieldError(undefined);

    const fd = new FormData(e.currentTarget);
    fd.set("tipo", tipo);

    const res = await postForm("/api/alta", fd);
    setSubmitting(false);

    if (res.success) {
      setSuccess(true);
      resetConditionals();
      formRef.current?.reset();
    } else {
      setError(res.error);
      setFieldError(res.field);
    }
  }

  function generarNota() {
    const f = formRef.current;
    if (!f) return;
    const fd = new FormData(f);
    const alycVal = (field(fd, "alyc") || "adcap") as Alyc;

    const html =
      tipo === "fisica"
        ? notaEpymeHtml({
            alyc: alycVal,
            esPersonaJuridica: false,
            caracterDomicilio: field(fd, "domicilio"),
            adminNombre: `${field(fd, "nombre")} ${field(fd, "apellido")}`.trim(),
            adminEmail: field(fd, "email"),
            adminDni: field(fd, "dni"),
            adminCuit: field(fd, "cuit"),
            adminTelefono: field(fd, "telefono"),
            adminDomicilioLegal: field(fd, "domicilio"),
            adminCargo: "Titular",
            firmante: `${field(fd, "apellido")}, ${field(fd, "nombre")}`.replace(/^, |, $/g, ""),
            firmanteCuit: field(fd, "cuit"),
            firmanteCargo: "Titular",
          })
        : notaEpymeHtml({
            alyc: alycVal,
            esPersonaJuridica: true,
            razonSocial: field(fd, "razon_social"),
            caracterDomicilio: field(fd, "domicilio_legal"),
            adminNombre: field(fd, "referente_nombre"),
            adminEmail: field(fd, "referente_email"),
            adminDni: field(fd, "referente_dni"),
            adminCuit: field(fd, "referente_cuit"),
            adminTelefono: field(fd, "referente_telefono"),
            adminDomicilioLegal: field(fd, "domicilio_legal"),
            adminCargo: field(fd, "referente_cargo") || "Representante legal",
            firmante: field(fd, "razon_social"),
            firmanteCuit: field(fd, "cuit"),
            firmanteCargo: field(fd, "referente_cargo") || "Representante legal",
          });

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  const fe = (name: string) => (fieldError === name ? error ?? undefined : undefined);

  return (
    <div className="flex flex-col gap-6">
      <Tabs<TipoAlta>
        tabs={[
          { value: "fisica", label: "Persona física" },
          { value: "juridica", label: "Persona jurídica" },
        ]}
        active={tipo}
        onChange={changeTipo}
      />

      <Alert tone="info" title="Todos los campos y adjuntos son obligatorios">
        Completá la información para la apertura de tu cuenta comitente. Vamos a
        contactarte con el referente indicado ante cualquier consulta.
      </Alert>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
        encType="multipart/form-data"
        noValidate
      >
        <Section title="Sociedad de bolsa (ALyC)">
          <Select
            name="alyc"
            label="¿Dónde abrís la cuenta?"
            required
            options={ALYC}
            placeholder="Seleccionar..."
            value={alyc}
            onChange={(e) => setAlyc(e.target.value as Alyc)}
            error={fe("alyc")}
          />
        </Section>

        {tipo === "fisica" ? (
          <FisicaFields fe={fe} estadoCivil={estadoCivil} setEstadoCivil={setEstadoCivil} />
        ) : (
          <JuridicaFields
            fe={fe}
            tipoSocietario={tipoSocietario}
            setTipoSocietario={setTipoSocietario}
            refEstadoCivil={refEstadoCivil}
            setRefEstadoCivil={setRefEstadoCivil}
          />
        )}

        <NotaEpymeBlock fe={fe} onGenerar={generarNota} />

        {error && !fieldError && (
          <Alert tone="error" title="No pudimos enviar el alta">
            {error}
          </Alert>
        )}
        {success && (
          <Alert tone="success" title="Alta recibida">
            Recibimos tus datos y documentación. Te contactamos a la brevedad para
            avanzar con la apertura de la cuenta.
          </Alert>
        )}

        <div>
          <Button type="submit" loading={submitting}>
            Enviar alta
          </Button>
        </div>
      </form>
    </div>
  );
}

type FE = (name: string) => string | undefined;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-sm font-semibold uppercase tracking-wide text-vertix/60">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function FisicaFields({
  fe,
  estadoCivil,
  setEstadoCivil,
}: {
  fe: FE;
  estadoCivil: string;
  setEstadoCivil: (v: string) => void;
}) {
  const casado = estadoCivil === "casado";
  return (
    <>
      <Section title="Datos del titular">
        <Input name="nombre" label="Nombre" required error={fe("nombre")} />
        <Input name="apellido" label="Apellido" required error={fe("apellido")} />
        <Input name="cuit" label="CUIT / CUIL" required inputMode="numeric" placeholder="Sólo números" error={fe("cuit")} />
        <Input name="dni" label="DNI" required inputMode="numeric" placeholder="Sólo números" error={fe("dni")} />
        <Input name="fecha_nacimiento" label="Fecha de nacimiento" required type="date" error={fe("fecha_nacimiento")} />
        <Select
          name="estado_civil"
          label="Estado civil"
          required
          options={ESTADO_CIVIL}
          placeholder="Seleccionar..."
          value={estadoCivil}
          onChange={(e) => setEstadoCivil(e.target.value)}
          error={fe("estado_civil")}
        />
        <Input name="nacimiento_provincia" label="Provincia de nacimiento" required error={fe("nacimiento_provincia")} />
        <Input name="nacimiento_localidad" label="Localidad de nacimiento" required hint="Aunque el DNI solo muestre la provincia, indicá la localidad." error={fe("nacimiento_localidad")} />
        <Input name="profesion" label="Profesión" required error={fe("profesion")} />
        <Select name="es_autonomo" label="¿Es autónomo?" required options={SI_NO} placeholder="Seleccionar..." defaultValue="" error={fe("es_autonomo")} />
        <Select name="es_pep" label="¿Persona Expuesta Políticamente?" required options={SI_NO} placeholder="Seleccionar..." defaultValue="" error={fe("es_pep")} />
        <Input name="cbu" label="CBU" required inputMode="numeric" placeholder="22 dígitos" error={fe("cbu")} />
      </Section>

      <Section title="Domicilio">
        <Input name="domicilio" label="Domicilio" required error={fe("domicilio")} />
        <Input name="localidad" label="Localidad" required error={fe("localidad")} />
        <Input name="provincia" label="Provincia" required error={fe("provincia")} />
        <Input name="codigo_postal" label="Código postal" required error={fe("codigo_postal")} />
      </Section>

      <Section title="Contacto">
        <Input name="email" type="email" label="Correo electrónico" required autoComplete="email" error={fe("email")} />
        <Input name="email_alternativo" type="email" label="Correo electrónico alternativo" required error={fe("email_alternativo")} />
        <Input name="telefono" label="Celular de contacto" required autoComplete="tel" error={fe("telefono")} />
      </Section>

      {casado && (
        <Section title="Datos del cónyuge">
          <Input name="conyuge_nombre" label="Nombre y apellido del cónyuge" required error={fe("conyuge_nombre")} />
          <Input name="conyuge_dni" label="DNI del cónyuge" required inputMode="numeric" placeholder="Sólo números" error={fe("conyuge_dni")} />
        </Section>
      )}

      <Section title="Documentación (PDF o imagen, máx. 5MB c/u)">
        <FileInput name="dni_frente" label="DNI (frente)" required accept={ACCEPT} error={fe("dni_frente")} />
        <FileInput name="dni_dorso" label="DNI (dorso)" required accept={ACCEPT} error={fe("dni_dorso")} />
        <FileInput name="constancia_cbu" label="Constancia de CBU" required accept={ACCEPT} error={fe("constancia_cbu")} />
        {casado && (
          <>
            <FileInput name="conyuge_dni_frente" label="DNI del cónyuge (frente)" required accept={ACCEPT} error={fe("conyuge_dni_frente")} />
            <FileInput name="conyuge_dni_dorso" label="DNI del cónyuge (dorso)" required accept={ACCEPT} error={fe("conyuge_dni_dorso")} />
          </>
        )}
      </Section>
    </>
  );
}

function JuridicaFields({
  fe,
  tipoSocietario,
  setTipoSocietario,
  refEstadoCivil,
  setRefEstadoCivil,
}: {
  fe: FE;
  tipoSocietario: string;
  setTipoSocietario: (v: string) => void;
  refEstadoCivil: string;
  setRefEstadoCivil: (v: string) => void;
}) {
  const conRegistroAcciones = tipoSocietario === "sa" || tipoSocietario === "sas";
  const casado = refEstadoCivil === "casado";
  return (
    <>
      <Section title="Datos de la empresa">
        <Input name="razon_social" label="Razón social" required error={fe("razon_social")} />
        <Input name="cuit" label="CUIT" required inputMode="numeric" placeholder="Sólo números" error={fe("cuit")} />
        <Select
          name="tipo_societario"
          label="Tipo societario"
          required
          options={TIPO_SOCIETARIO}
          placeholder="Seleccionar..."
          value={tipoSocietario}
          onChange={(e) => setTipoSocietario(e.target.value)}
          error={fe("tipo_societario")}
        />
        <Input name="fecha_constitucion" label="Fecha de constitución" required type="date" error={fe("fecha_constitucion")} />
        <Input name="actividad" label="Actividad principal" required error={fe("actividad")} />
        <Select name="es_pep" label="¿Algún socio/autoridad es PEP?" required options={SI_NO} placeholder="Seleccionar..." defaultValue="" error={fe("es_pep")} />
        <Input name="cbu" label="CBU de la empresa" required inputMode="numeric" placeholder="22 dígitos" error={fe("cbu")} />
      </Section>

      <Section title="Domicilio legal">
        <Input name="domicilio_legal" label="Domicilio legal" required error={fe("domicilio_legal")} />
        <Input name="localidad" label="Localidad" required error={fe("localidad")} />
        <Input name="provincia" label="Provincia" required error={fe("provincia")} />
        <Input name="codigo_postal" label="Código postal" required error={fe("codigo_postal")} />
      </Section>

      <Section title="Contacto de la empresa">
        <Input name="email" type="email" label="Correo electrónico principal" required autoComplete="email" error={fe("email")} />
        <Input name="email_alternativo" type="email" label="Correo electrónico alternativo" required error={fe("email_alternativo")} />
        <Input name="telefono" label="Celular de contacto" required autoComplete="tel" error={fe("telefono")} />
      </Section>

      <Section title="Firmante / apoderado">
        <Input name="referente_nombre" label="Nombre y apellido" required error={fe("referente_nombre")} />
        <Input name="referente_cargo" label="Cargo" required placeholder="Presidente, apoderado, etc." error={fe("referente_cargo")} />
        <Input name="referente_cuit" label="CUIT / CUIL del firmante" required inputMode="numeric" placeholder="Sólo números" error={fe("referente_cuit")} />
        <Input name="referente_dni" label="DNI del firmante" required inputMode="numeric" placeholder="Sólo números" error={fe("referente_dni")} />
        <Select
          name="referente_estado_civil"
          label="Estado civil del firmante"
          required
          options={ESTADO_CIVIL}
          placeholder="Seleccionar..."
          value={refEstadoCivil}
          onChange={(e) => setRefEstadoCivil(e.target.value)}
          error={fe("referente_estado_civil")}
        />
        <Input name="referente_telefono" label="Teléfono del firmante" required error={fe("referente_telefono")} />
        <Input name="referente_email" type="email" label="Email del firmante" required error={fe("referente_email")} />
      </Section>

      <Section title="Socios / firmantes">
        <div className="md:col-span-2">
          <Textarea
            name="datos_socios"
            label="Datos de socios y firmantes"
            required
            hint="Profesión, estado civil y lugar de nacimiento de cada socio o firmante que no figure en el estatuto."
            error={fe("datos_socios")}
          />
        </div>
      </Section>

      {casado && (
        <Section title="Datos del cónyuge del firmante">
          <Input name="conyuge_nombre" label="Nombre y apellido del cónyuge" required error={fe("conyuge_nombre")} />
          <Input name="conyuge_dni" label="DNI del cónyuge" required inputMode="numeric" placeholder="Sólo números" error={fe("conyuge_dni")} />
        </Section>
      )}

      <Section title="Documentación (PDF o imagen, máx. 5MB c/u)">
        <FileInput name="estatuto" label="Estatuto y modificaciones inscriptas" required accept={ACCEPT} error={fe("estatuto")} />
        {conRegistroAcciones && (
          <FileInput name="registro_acciones" label="Libro de Registro de Acciones" required accept={ACCEPT} error={fe("registro_acciones")} />
        )}
        <FileInput name="constancia_cuit" label="Constancia de CUIT" required accept={ACCEPT} error={fe("constancia_cuit")} />
        <FileInput name="constancia_cbu" label="Constancia de CBU" required accept={ACCEPT} error={fe("constancia_cbu")} />
        <FileInput name="dni_socios" label="DNI de los socios (frente y dorso)" required accept={ACCEPT} hint="Podés subir un PDF con todos." error={fe("dni_socios")} />
        <FileInput name="eecc" label="Estados contables (CPCE)" accept={ACCEPT} hint="Si no tenés EECC, subí las DDJJ debajo." error={fe("eecc")} />
        <FileInput name="ddjj" label="Últimas 6 DDJJ de IVA e IIBB" accept={ACCEPT} hint="Sólo si no presentás estados contables." error={fe("ddjj")} />
      </Section>
    </>
  );
}

function NotaEpymeBlock({ fe, onGenerar }: { fe: FE; onGenerar: () => void }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-xl border border-vertix/15 bg-vertix/5 p-5">
      <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Nota de Adhesión EPYME
      </legend>
      <p className="text-sm text-vertix/70">
        Generá la nota pre-llenada con los datos cargados arriba, imprimila o guardala
        en PDF, firmala y volvé a subirla acá.
      </p>
      <div>
        <Button type="button" variant="secondary" onClick={onGenerar}>
          Generar Nota EPYME
        </Button>
      </div>
      <FileInput
        name="nota_epyme_firmada"
        label="Nota de Adhesión EPYME firmada"
        required
        accept={ACCEPT}
        error={fe("nota_epyme_firmada")}
      />
    </fieldset>
  );
}
