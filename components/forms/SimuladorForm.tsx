"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postJson } from "@/lib/api-client";
import { hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";
import { formatearCuit } from "@/lib/cuit";
import { MIN_DIAS_HABILES } from "@/lib/validations";
import type {
  BcraInfo,
  SimuladorChequesOutput,
  SimuladorPrestamosOutput,
} from "@/types";

type Tipo = "cheques" | "prestamos";
type ChequesResult = SimuladorChequesOutput;
type PrestamosResult = SimuladorPrestamosOutput;

const TIPO_PERSONA = [
  { value: "humana", label: "Persona humana" },
  { value: "empresa", label: "Empresa" },
];
const INSTRUMENTO = [
  { value: "cheque", label: "Cheque" },
  { value: "echeq", label: "Echeq" },
  { value: "fce", label: "FCE (Factura de Crédito Electrónica)" },
];
const MODALIDAD = [
  { value: "directo", label: "Directo con Vertix" },
  { value: "comitente", label: "Abriendo cuenta comitente (tasa más baja)" },
];

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const fmtFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function SimuladorForm() {
  const [tipo, setTipo] = useState<Tipo>("cheques");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [chequesResult, setChequesResult] = useState<ChequesResult | null>(null);
  const [prestamosResult, setPrestamosResult] = useState<PrestamosResult | null>(null);
  const [fechaPago, setFechaPago] = useState("");

  // Fecha mínima de pago = hoy + 5 días hábiles (no se descuentan valores con menor plazo).
  const minFechaPago = useMemo(
    () => toISODate(sumarDiasHabiles(hoy(), MIN_DIAS_HABILES)),
    []
  );
  const fechaMuyCercana = fechaPago !== "" && fechaPago < minFechaPago;

  function changeTipo(next: Tipo) {
    setTipo(next);
    setError(null);
    setFieldError(undefined);
    setChequesResult(null);
    setPrestamosResult(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldError(undefined);

    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(fd.entries());

    if (tipo === "cheques") {
      const payload = {
        tipo,
        monto: Number(raw.monto),
        fecha_pago: String(raw.fecha_pago ?? ""),
        modalidad: String(raw.modalidad ?? ""),
        instrumento: String(raw.instrumento ?? ""),
        cuit_librador: String(raw.cuit_librador ?? ""),
        cuit_endosatario: String(raw.cuit_endosatario ?? ""),
      };
      const res = await postJson<ChequesResult>("/api/simulador", payload);
      setSubmitting(false);
      if (res.success) setChequesResult(res.data);
      else {
        setError(res.error);
        setFieldError(res.field);
        setChequesResult(null);
      }
    } else {
      const payload = {
        tipo,
        monto: Number(raw.monto),
        plazo_meses: Number(raw.plazo_meses),
        tipo_persona: String(raw.tipo_persona),
      };
      const res = await postJson<PrestamosResult>("/api/simulador", payload);
      setSubmitting(false);
      if (res.success) setPrestamosResult(res.data);
      else {
        setError(res.error);
        setFieldError(res.field);
        setPrestamosResult(null);
      }
    }
  }

  const fe = (name: string) => (fieldError === name ? error ?? undefined : undefined);

  return (
    <div className="flex flex-col gap-6">
      <Tabs<Tipo>
        tabs={[
          { value: "cheques", label: "Descuento de cheques" },
          { value: "prestamos", label: "Préstamos" },
        ]}
        active={tipo}
        onChange={changeTipo}
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            name="monto"
            label={tipo === "cheques" ? "Monto del cheque (ARS)" : "Monto del préstamo (ARS)"}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="1"
            required
            error={fe("monto")}
          />
          {tipo === "cheques" ? (
            <>
              <Select
                name="instrumento"
                label="Instrumento"
                options={INSTRUMENTO}
                placeholder="Seleccionar..."
                defaultValue="cheque"
                required
                error={fe("instrumento")}
              />
              <Select
                name="modalidad"
                label="Modalidad"
                options={MODALIDAD}
                placeholder="Seleccionar..."
                defaultValue="directo"
                required
                hint="Con cuenta comitente la tasa es más baja."
                error={fe("modalidad")}
              />
              <Input
                name="fecha_pago"
                label="Fecha de pago del cheque"
                type="date"
                min={minFechaPago}
                required
                hint={`Mínimo ${MIN_DIAS_HABILES} días hábiles desde hoy.`}
                onChange={(e) => setFechaPago(e.target.value)}
                error={fe("fecha_pago")}
              />
              <Input
                name="cuit_librador"
                label="CUIT del librador del cheque"
                inputMode="numeric"
                placeholder="Sólo números"
                required
                error={fe("cuit_librador")}
              />
              <Input
                name="cuit_endosatario"
                label="CUIT del endosatario (a quién se endosa)"
                inputMode="numeric"
                placeholder="Sólo números"
                required
                hint="No puede coincidir con el del librador."
                error={fe("cuit_endosatario")}
              />
            </>
          ) : (
            <>
              <Input
                name="plazo_meses"
                label="Plazo (meses)"
                type="number"
                inputMode="numeric"
                min="1"
                max="120"
                required
                error={fe("plazo_meses")}
              />
              <Select
                name="tipo_persona"
                label="Tipo de persona"
                options={TIPO_PERSONA}
                placeholder="Seleccionar..."
                defaultValue=""
                required
                error={fe("tipo_persona")}
              />
            </>
          )}
        </div>

        {tipo === "cheques" && fechaMuyCercana && (
          <Alert tone="warning" title="Fecha de pago menor a 5 días hábiles">
            Por este medio no podemos cotizar cheques con vencimiento menor a 5 días
            hábiles. <Link href="/contacto" className="font-semibold underline">Comunicate con nosotros</Link>{" "}
            y podemos ver otra manera de negociación.
          </Alert>
        )}

        {tipo === "cheques" && (
          <p className="text-xs text-vertix/60">
            * No se realizan descuentos de cheques propios (cuando el librador y el
            endosatario coinciden). Esos casos se canalizan como préstamo.
          </p>
        )}

        {error && !fieldError && (
          <Alert tone="error" title="No pudimos calcular la simulación">
            {error}
          </Alert>
        )}

        <div className="pt-2">
          <Button type="submit" loading={submitting}>
            Simular
          </Button>
        </div>
      </form>

      {tipo === "cheques" && chequesResult && <ChequesResultCard data={chequesResult} />}
      {tipo === "prestamos" && prestamosResult && <PrestamosResultCard data={prestamosResult} />}
    </div>
  );
}

function ResultCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-vertix/15 bg-vertix/5 p-6">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-vertix/60">{label}</span>
      <span className="text-base font-semibold tabular-nums text-vertix">{value}</span>
    </div>
  );
}

function ChequesResultCard({ data }: { data: ChequesResult }) {
  return (
    <ResultCard>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Resultado
      </h3>
      <div className="divide-y divide-vertix/10">
        <Row label="Monto a recibir" value={ARS.format(data.monto_a_recibir)} />
        <Row label="Descuento total" value={ARS.format(data.descuento_total)} />
        <Row
          label="Modalidad"
          value={data.modalidad === "comitente" ? "Cuenta comitente" : "Directo con Vertix"}
        />
        <Row label="Días considerados" value={`${data.dias_considerados}`} />
        <Row label="Acreditación estimada" value={fmtFecha(data.fecha_acreditacion_estimada)} />
        <Row label="Tasa de descuento (TNA)" value={`${data.tna_interes}%`} />
        <Row label="Arancel" value={`${data.arancel}%`} />
        <Row label="Tasa total aplicada (TNA)" value={`${data.tna_aplicada}%`} />
      </div>
      {data.bcra && (
        <div className="mt-5">
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-vertix/60">
            Verificación BCRA
          </h4>
          <div className="flex flex-col gap-2">
            <BcraRow titulo="Librador" info={data.bcra.librador} />
            <BcraRow titulo="Endosatario" info={data.bcra.endosatario} />
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-vertix/60">{data.disclaimer}</p>
    </ResultCard>
  );
}

const BCRA_ESTILO: Record<
  BcraInfo["estado"],
  { label: string; clase: string }
> = {
  ok: { label: "Sin observaciones", clase: "bg-green-100 text-green-800" },
  analisis: { label: "Requiere análisis", clase: "bg-amber-100 text-amber-800" },
  riesgo: { label: "Situación de riesgo", clase: "bg-red-100 text-red-800" },
  no_verificado: { label: "No se pudo verificar", clase: "bg-vertix/10 text-vertix/70" },
};

function BcraRow({ titulo, info }: { titulo: string; info: BcraInfo }) {
  const e = BCRA_ESTILO[info.estado];
  return (
    <div className="rounded-lg border border-vertix/10 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-vertix">{titulo}</p>
          <p className="truncate text-xs text-vertix/60">
            CUIT {formatearCuit(info.cuit)}
            {info.situacion != null && ` · Situación ${info.situacion}`}
            {info.cheques_rechazados && " · cheques rechazados"}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${e.clase}`}>
          {e.label}
        </span>
      </div>
    </div>
  );
}

function PrestamosResultCard({ data }: { data: PrestamosResult }) {
  return (
    <ResultCard>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Resultado
      </h3>
      <div className="divide-y divide-vertix/10">
        <Row label="Cuota mensual" value={ARS.format(data.cuota_mensual)} />
        <Row label="Total a pagar" value={ARS.format(data.total_a_pagar)} />
        <Row label="Total intereses" value={ARS.format(data.total_intereses)} />
        <Row label="Tasa aplicada (TNA)" value={`${data.tna_aplicada}%`} />
        <Row label="Tasa mensual" value={`${data.tasa_mensual}%`} />
      </div>
      <p className="mt-4 text-xs text-vertix/60">{data.disclaimer}</p>
    </ResultCard>
  );
}
