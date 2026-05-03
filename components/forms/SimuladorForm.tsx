"use client";

import { FormEvent, useState } from "react";
import { Input, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postJson } from "@/lib/api-client";
import type {
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

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function SimuladorForm() {
  const [tipo, setTipo] = useState<Tipo>("cheques");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [chequesResult, setChequesResult] = useState<ChequesResult | null>(null);
  const [prestamosResult, setPrestamosResult] = useState<PrestamosResult | null>(null);

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

    const payload =
      tipo === "cheques"
        ? {
            tipo,
            monto: Number(raw.monto),
            dias_vencimiento: Number(raw.dias_vencimiento),
          }
        : {
            tipo,
            monto: Number(raw.monto),
            plazo_meses: Number(raw.plazo_meses),
            tipo_persona: String(raw.tipo_persona),
          };

    if (tipo === "cheques") {
      const res = await postJson<ChequesResult>("/api/simulador", payload);
      setSubmitting(false);
      if (res.success) setChequesResult(res.data);
      else {
        setError(res.error);
        setFieldError(res.field);
        setChequesResult(null);
      }
    } else {
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
            <Input
              name="dias_vencimiento"
              label="Días al vencimiento"
              type="number"
              inputMode="numeric"
              min="1"
              max="365"
              required
              error={fe("dias_vencimiento")}
            />
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
        <Row label="Tasa diaria aplicada" value={`${data.tasa_aplicada}%`} />
      </div>
      <p className="mt-4 text-xs text-vertix/60">{data.disclaimer}</p>
    </ResultCard>
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
        <Row label="Tasa mensual aplicada" value={`${(data.tasa_aplicada * 100).toFixed(2)}%`} />
      </div>
      <p className="mt-4 text-xs text-vertix/60">{data.disclaimer}</p>
    </ResultCard>
  );
}
