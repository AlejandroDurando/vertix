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
  PLAZO_OPCIONES,
  PORCENTAJE_ACEPTADO_FCE,
  fechaConcertacion,
  fechaPagoMinima,
  instrumentoSoloComitente,
  instrumentoSoloDirecto,
  modalidadRequiereMinDias,
  valorAceptadoSugerido,
  type Concertacion,
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
const CONCERTACION = [
  { value: "hoy", label: "Hoy" },
  { value: "manana", label: "Mañana (próximo día hábil)" },
];

const CLAVE_INTERNO = "vertix:interno";

/**
 * Si el simulador está en modo interno.
 *
 * Viaja en la URL (`?interno=1`), pero el parámetro se pierde al navegar por el
 * menú y alcanza un carácter de más al copiarlo —`?interno=1:`— para que no
 * active nada, sin ninguna señal de por qué. Así que se acepta cualquier forma
 * razonable del valor, se recuerda mientras dure la pestaña y se apaga
 * explícitamente con `?interno=0`.
 */
function leerInterno(): boolean {
  const crudo = new URLSearchParams(window.location.search).get("interno");
  if (crudo != null) {
    const activo = /^\s*(1|true|si|sí)\b/i.test(crudo);
    try {
      if (activo) sessionStorage.setItem(CLAVE_INTERNO, "1");
      else sessionStorage.removeItem(CLAVE_INTERNO);
    } catch {
      // Modo privado de Safari: el flag vale sólo para esta página.
    }
    return activo;
  }
  try {
    return sessionStorage.getItem(CLAVE_INTERNO) === "1";
  } catch {
    return false;
  }
}

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const fmtFecha = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Porcentaje con coma decimal, como se escribe en castellano. */
const fmtPct = (n: number) => `${String(n).replace(".", ",")}%`;

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
  const [concertacion, setConcertacion] = useState<Concertacion>("hoy");
  // El valor aceptado de la FCE se precarga con el 80% del total y se puede
  // corregir: en cuanto se toca, deja de recalcularse solo.
  const [montoTotal, setMontoTotal] = useState("");
  const [aceptado, setAceptado] = useState("");
  const [aceptadoEditado, setAceptadoEditado] = useState(false);

  // Quien simula desde la web no sabe quién va a comprar el cheque —lo consigue
  // Vertix—, así que la percepción de IVA se cotiza siempre. Con ?interno=1 el
  // equipo puede elegir la condición del comprador y ver el número final.
  useEffect(() => {
    setInterno(leerInterno());
  }, []);

  // El cheque físico no se negocia en el mercado (sólo directo) y la FCE sólo
  // se negocia ahí (sólo comitente). El echeq admite las dos vías.
  const soloDirecto = instrumentoSoloDirecto(instrumento);
  const soloComitente = instrumentoSoloComitente(instrumento);
  const esFce = instrumento === "fce";
  const modalidadEfectiva: ModalidadCheque = soloDirecto
    ? "directo"
    : soloComitente
      ? "comitente"
      : modalidad;

  // El mínimo de 5 días hábiles lo exige el mercado de capitales: sólo rige
  // para la cuenta comitente. Directo con Vertix se puede operar con menos.
  // Se cuenta desde el día en que se concierta, que puede ser mañana.
  const exigeMinDias = modalidadRequiereMinDias(modalidadEfectiva);
  const minFechaPago = useMemo(
    () => toISODate(fechaPagoMinima(fechaConcertacion(concertacion))),
    [concertacion]
  );

  // 80% del total, redondeado a centavos, mientras nadie lo corrija.
  const aceptadoSugerido = useMemo(() => {
    const n = Number(montoTotal);
    return Number.isFinite(n) && n > 0 ? String(valorAceptadoSugerido(n)) : "";
  }, [montoTotal]);
  const valorAceptado = aceptadoEditado ? aceptado : aceptadoSugerido;
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
        ...(raw.monto_aceptado ? { monto_aceptado: Number(raw.monto_aceptado) } : {}),
        fecha_pago: String(raw.fecha_pago ?? ""),
        modalidad: String(raw.modalidad ?? ""),
        instrumento: String(raw.instrumento ?? ""),
        cuit_librador: String(raw.cuit_librador ?? ""),
        cuit_endosatario: String(raw.cuit_endosatario ?? ""),
        ...(interno
          ? {
              condicion_comprador: String(raw.condicion_comprador ?? "ri"),
              concertacion,
            }
          : {}),
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
      {/* Sin esto no había manera de saber si el modo interno quedó activo:
          sus controles sólo aparecen en algunas combinaciones. */}
      {interno && (
        <div className="rounded-lg border border-vertix/20 bg-vertix/5 px-4 py-3 text-sm text-vertix">
          <strong>Modo interno.</strong> Podés elegir la fecha de concertación y
          la condición del comprador, y el resultado muestra el desglose de la
          tasa. Para volver a la vista pública, abrí la misma dirección con{" "}
          <code className="font-mono">?interno=0</code>.
        </div>
      )}
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
            label={
              tipo === "prestamos"
                ? "Monto del préstamo (ARS)"
                : esFce
                  ? "Valor total de la factura (ARS)"
                  : "Monto del cheque (ARS)"
            }
            type="number"
            inputMode="decimal"
            step="0.01"
            min="1"
            required
            value={montoTotal}
            onChange={(e) => setMontoTotal(e.target.value)}
            error={fe("monto")}
          />
          {tipo === "cheques" ? (
            <>
              {/* En la FCE se negocia sólo la parte que el comprador acepta.
                  Por lo general es el 80%, así que se precarga y se corrige
                  únicamente cuando la operación viene con otro importe. */}
              {esFce && (
                <Input
                  name="monto_aceptado"
                  label="Valor aceptado (ARS)"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  required
                  value={valorAceptado}
                  onChange={(e) => {
                    setAceptadoEditado(true);
                    setAceptado(e.target.value);
                  }}
                  hint={`Calculado como el ${PORCENTAJE_ACEPTADO_FCE}% del total de la factura. Si el saldo aceptado es otro, colocá el correspondiente.`}
                  error={fe("monto_aceptado")}
                />
              )}
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
                    ? `Mínimo ${MIN_DIAS_HABILES} días hábiles contando hoy (lo exige el mercado de capitales).`
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
              {interno && (
                <Select
                  name="concertacion"
                  label="Fecha de concertación"
                  options={CONCERTACION}
                  value={concertacion}
                  onChange={(e) => setConcertacion(e.target.value as Concertacion)}
                  hint="Sólo visible en el simulador interno. Con “mañana” se cotiza como si la operación se cerrara el próximo día hábil: cambian los días de descuento, el tramo de tasa y el mínimo de vencimiento."
                  error={fe("concertacion")}
                />
              )}
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
            <Select
              name="plazo_meses"
              label="Plazo"
              options={PLAZO_OPCIONES}
              placeholder="Seleccionar..."
              defaultValue=""
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

      {tipo === "cheques" && chequesResult && (
        <ChequesResultCard data={chequesResult} interno={interno} />
      )}
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

function ChequesResultCard({
  data,
  interno,
}: {
  data: ChequesResult;
  interno: boolean;
}) {
  return (
    <ResultCard>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-vertix/60">
        Resultado
      </h3>
      <div className="divide-y divide-vertix/10">
        <Row label="Monto a recibir" value={ARS.format(data.monto_a_recibir)} />
        <Row label="Descuento total" value={ARS.format(data.descuento_total)} />
        <Row label="Valor negociado" value={ARS.format(data.monto_negociado)} />
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
        {/* En el mercado se informa un solo porcentaje: el global (por ejemplo
            el 40% de la FCE), aunque por dentro se calcule como tasa + arancel.
            Fuera del mercado el arancel es una comisión fija sobre el capital,
            así que sumarlo a la tasa daría un número sin sentido: ahí se informa
            sólo la tasa de descuento y los gastos van en el detalle, en pesos. */}
        {data.modalidad === "comitente" ? (
          <Row label="Tasa total (TNA)" value={fmtPct(data.tna_aplicada)} />
        ) : (
          <Row label="Tasa de descuento (TNA)" value={fmtPct(data.tna_interes)} />
        )}
        {interno && data.modalidad === "comitente" && (
          <Row
            label="Desglose interno"
            value={`${fmtPct(data.tna_interes)} tasa + ${fmtPct(data.arancel)} arancel`}
          />
        )}
        <Row label="Costo total sobre el nominal" value={fmtPct(data.costo_total_pct)} />
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

      {/* Lo que pone quien compra el cheque: a veces Vertix, a veces un inversor
          externo al que hay que decirle cuánto necesita para entrar. Sale del
          bloque COMPRADOR de la planilla y sólo se muestra en el interno. */}
      {interno && data.comprador && (
        <div className="mt-6 rounded-lg border border-vertix/20 bg-white p-4">
          <h4 className="mb-1 text-sm font-semibold uppercase tracking-wide text-vertix/60">
            Lo que paga el comprador
          </h4>
          <div className="divide-y divide-vertix/10">
            {data.comprador.costos.map((c) => (
              <div
                key={c.concepto}
                className="flex items-baseline justify-between gap-4 py-1.5"
              >
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
            <Row
              label="Total a desembolsar"
              value={ARS.format(data.comprador.total_a_pagar)}
            />
          </div>
          <p className="mt-3 text-xs text-vertix/60">
            Entre lo que pone el comprador y lo que cobra el vendedor hay{" "}
            <strong>{ARS.format(data.comprador.diferencia_con_vendedor)}</strong> de
            aranceles, derechos e impuestos.
          </p>
        </div>
      )}

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
        {/* La cuota es fija: el total repartido en partes iguales, IVA incluido.
            El cuadro por dentro es francés, pero eso no se cobra así. */}
        <Row
          label="Cuota mensual fija"
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
          label="IVA sobre los intereses"
          value={rango(data.total_iva_desde, data.total_iva_hasta, ARS.format)}
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
