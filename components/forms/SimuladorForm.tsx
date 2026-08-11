"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input, NumberInput, Select } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Tabs } from "@/components/ui/Tabs";
import { postJson } from "@/lib/api-client";
import { hoy, sumarDiasHabiles, toISODate } from "@/lib/fechas";
import { formatearCuit } from "@/lib/cuit";
import {
  MIN_DIAS_HABILES,
  MODALIDAD_OPCIONES,
  instrumentoSoloComitente,
  instrumentoSoloDirecto,
  modalidadRequiereMinDias,
} from "@/lib/validations";
import { TELEFONO, TELEFONO_URL, WHATSAPP_URL } from "@/lib/contacto";
import type {
  BcraInfo,
  InstrumentoCheque,
  ModalidadCheque,
  SimuladorChequesOutput,
  SimuladorPrestamosOutput,
} from "@/types";

type Tipo = "cheques" | "prestamos";
type ChequesResult = SimuladorChequesOutput;
type PrestamosResult = SimuladorPrestamosOutput;

const INSTRUMENTO = [
  { value: "cheque", label: "Cheque" },
  { value: "echeq", label: "Echeq" },
  { value: "fce", label: "FCE (Factura de Crédito Electrónica)" },
];
const CONDICION_COMPRADOR = [
  { value: "ri", label: "Responsable Inscripto" },
  { value: "mono_cf", label: "Monotributista o consumidor final" },
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
  const [modalidad, setModalidad] = useState<ModalidadCheque>("directo");
  const [instrumento, setInstrumento] = useState<InstrumentoCheque>("cheque");
  const [interno, setInterno] = useState(false);

  // Quien simula desde la web no sabe quién va a comprar el cheque —lo consigue
  // Vertix—, así que la percepción de IVA se cotiza siempre. Con ?interno=1 el
  // equipo puede elegir la condición del comprador y ver el número final.
  useEffect(() => {
    setInterno(new URLSearchParams(window.location.search).get("interno") === "1");
  }, []);

  // El cheque físico no se negocia en el mercado (sólo directo) y la FCE sólo
  // se negocia ahí (sólo comitente). El echeq admite las dos vías.
  const soloDirecto = instrumentoSoloDirecto(instrumento);
  const soloComitente = instrumentoSoloComitente(instrumento);
  const modalidadEfectiva: ModalidadCheque = soloDirecto
    ? "directo"
    : soloComitente
      ? "comitente"
      : modalidad;

  // El mínimo de 5 días hábiles lo exige el mercado de capitales: sólo rige
  // para la cuenta comitente. Directo con Vertix se puede operar con menos.
  const exigeMinDias = modalidadRequiereMinDias(modalidadEfectiva);
  const minFechaPago = useMemo(
    () => toISODate(sumarDiasHabiles(hoy(), MIN_DIAS_HABILES)),
    []
  );
  const fechaMuyCercana = exigeMinDias && fechaPago !== "" && fechaPago < minFechaPago;

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
        ...(interno ? { condicion_comprador: String(raw.condicion_comprador ?? "ri") } : {}),
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
                value={instrumento}
                onChange={(e) => setInstrumento(e.target.value as InstrumentoCheque)}
                required
                error={fe("instrumento")}
              />
              <Select
                name="modalidad"
                label="Modalidad"
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
                required
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
                name="fecha_pago"
                label="Fecha de pago del cheque"
                type="date"
                min={exigeMinDias ? minFechaPago : undefined}
                required
                hint={
                  exigeMinDias
                    ? `Mínimo ${MIN_DIAS_HABILES} días hábiles desde hoy (lo exige el mercado de capitales).`
                    : undefined
                }
                onChange={(e) => setFechaPago(e.target.value)}
                error={fe("fecha_pago")}
              />
              <NumberInput
                name="cuit_librador"
                label="CUIT del librador del cheque"
                maxDigits={11}
                placeholder="11 números"
                required
                error={fe("cuit_librador")}
              />
              <NumberInput
                name="cuit_endosatario"
                label="CUIT del endosatario (a quién se endosa)"
                maxDigits={11}
                placeholder="11 números"
                required
                hint="No puede coincidir con el del librador."
                error={fe("cuit_endosatario")}
              />
              {interno && modalidadEfectiva === "comitente" && (
                <Select
                  name="condicion_comprador"
                  label="Condición del comprador frente al IVA"
                  options={CONDICION_COMPRADOR}
                  defaultValue="ri"
                  hint="Sólo visible en el simulador interno. El monotributista y el consumidor final no pagan la percepción."
                  error={fe("condicion_comprador")}
                />
              )}
            </>
          ) : (
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
          )}
        </div>

        {tipo === "cheques" && fechaMuyCercana && (
          <Alert tone="warning" title="Fecha de pago menor a 5 días hábiles">
            Con cuenta comitente no podemos tomar valores con vencimiento menor a 5
            días hábiles: lo exige el mercado de capitales. Probá con{" "}
            <strong>Sin cuenta comitente en el mercado de capitales</strong> o llamanos al{" "}
            <a href={TELEFONO_URL} className="font-semibold underline">{TELEFONO}</a>{" "}
            (<a href={WHATSAPP_URL} className="font-semibold underline" target="_blank" rel="noreferrer">WhatsApp</a>){" "}
            para ver otra manera de negociación.
          </Alert>
        )}

        {tipo === "cheques" && (
          <p className="text-xs text-vertix/60">
            * No se realizan descuentos de cheques propios (cuando el librador y el
            endosatario coinciden). Esos casos se canalizan como préstamo.
          </p>
        )}

        {/* El BCRA no es la última palabra: una situación mala en un banco no
            descarta la operación, Vertix puede analizarla a mano. */}
        {error && fieldError === "bcra" && (
          <Alert tone="warning" title="No podemos emitir el presupuesto">
            <p>{error}</p>
            <p className="mt-2">
              De todos modos, si querés vender el cheque podés{" "}
              <Link href="/precalificacion" className="font-semibold underline">
                enviarnos una pre-calificación
              </Link>{" "}
              para que lo analicemos. A veces el librador figura con una situación
              comprometida en un banco pero está bien en los demás, y si no tiene
              cheques rechazados igual podemos considerar la compra.
            </p>
          </Alert>
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
          value={
            data.modalidad === "comitente"
              ? "Con cuenta comitente en el mercado de capitales"
              : "Sin cuenta comitente en el mercado de capitales"
          }
        />
        <Row label="Días considerados" value={`${data.dias_considerados}`} />
        <Row
          label="Acreditación al vendedor"
          value={fmtFecha(data.fecha_acreditacion_vendedor)}
        />
        <Row
          label="Acreditación estimada (comprador)"
          value={fmtFecha(data.fecha_acreditacion_estimada)}
        />
        <Row label="Tramo de plazo" value={data.tramo} />
        <Row label="Tasa de descuento (TNA)" value={`${data.tna_interes}%`} />
        <Row label="Costo total sobre el nominal" value={`${data.costo_total_pct}%`} />
      </div>

      <h4 className="mb-1 mt-5 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Detalle del descuento
      </h4>
      <div className="divide-y divide-vertix/10">
        {data.costos.map((c) => (
          <div key={c.concepto} className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="text-sm text-vertix/60">
              {c.concepto}
              {c.detalle && (
                <span className="block text-xs text-vertix/40">{c.detalle}</span>
              )}
            </span>
            <span className="whitespace-nowrap text-base font-semibold tabular-nums text-vertix">
              {ARS.format(c.monto)}
            </span>
          </div>
        ))}
      </div>

      {data.incluye_percepcion && (
        <p className="mt-3 text-xs text-vertix/60">
          Incluye la percepción de IVA, que se cobra cuando el comprador es
          Responsable Inscripto. Si el comprador resulta monotributista o consumidor
          final, no se cobra y el monto a recibir es mayor.
        </p>
      )}
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
  const rango = (desde: number, hasta: number, fmt: (n: number) => string) =>
    desde === hasta ? fmt(desde) : `${fmt(desde)} – ${fmt(hasta)}`;

  return (
    <ResultCard>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Resultado estimado
      </h3>
      <div className="divide-y divide-vertix/10">
        <Row
          label="Cuota mensual"
          value={rango(data.cuota_mensual_desde, data.cuota_mensual_hasta, ARS.format)}
        />
        <Row
          label="Total a pagar"
          value={rango(data.total_a_pagar_desde, data.total_a_pagar_hasta, ARS.format)}
        />
        <Row
          label="Total intereses"
          value={rango(data.total_intereses_desde, data.total_intereses_hasta, ARS.format)}
        />
        <Row
          label="Tasa (TNA)"
          value={rango(data.tna_desde, data.tna_hasta, (n) => `${n}%`)}
        />
      </div>
      <p className="mt-4 text-xs text-vertix/60">{data.disclaimer}</p>
    </ResultCard>
  );
}
