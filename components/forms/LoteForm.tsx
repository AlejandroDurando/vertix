"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { NumberInput, Select } from "@/components/ui/Field";
import { postForm, postJson } from "@/lib/api-client";
import { comprimirImagen } from "@/lib/adjuntos-client";
import { toISODate } from "@/lib/fechas";
import {
  MAX_FILAS_LOTE,
  MIN_DIAS_HABILES,
  MODALIDAD_OPCIONES,
  fechaConcertacion,
  fechaPagoMinima,
  instrumentoSoloComitente,
  instrumentoSoloDirecto,
  modalidadRequiereMinDias,
  valorAceptadoSugerido,
  type Concertacion,
} from "@/lib/validations";
import type { ChequeLeido, LecturaResultado } from "@/lib/lector-cheques";
import { resumirRevision, revisarFilas, type RevisionFila } from "@/lib/revision-lote";
import type {
  BcraInfo,
  InstrumentoCheque,
  LoteOutput,
  ModalidadCheque,
} from "@/types";

/** Estado de cada archivo mientras se lee. */
type Lectura = {
  nombre: string;
  estado: "leyendo" | "listo" | "vacio" | "error";
  detalle?: string;
};

const INSTRUMENTO = [
  { value: "cheque", label: "Cheque" },
  { value: "echeq", label: "Echeq" },
  { value: "fce", label: "FCE (Factura de Crédito Electrónica)" },
];
const CONDICION_VENDEDOR = [
  { value: "ri", label: "Responsable Inscripto" },
  { value: "mono_cf", label: "Monotributista o consumidor final" },
];
const CONCERTACION = [
  { value: "hoy", label: "Hoy" },
  { value: "manana", label: "Mañana (próximo día hábil)" },
];

const ARS = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});
const ARS2 = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type Fila = {
  id: string;
  monto: string;
  monto_aceptado: string;
  fecha_pago: string;
  cuit_librador: string;
  banco: string;
  numero: string;
  /** Importe en letras que leyó el lector, para cotejarlo contra el de arriba. */
  nominal_en_letras: number | null;
};

const filaVacia = (id: string): Fila => ({
  id,
  monto: "",
  monto_aceptado: "",
  fecha_pago: "",
  cuit_librador: "",
  banco: "",
  numero: "",
  nominal_en_letras: null,
});

// La tabla no puede llevar una etiqueta visible por celda como el resto de los
// formularios: se repetiría diez veces por columna. Los inputs comparten el
// mismo lenguaje visual que `components/ui/Field` y llevan `aria-label`.
const celda =
  "w-full rounded-md border border-vertix/15 bg-white px-2 py-1.5 text-sm text-vertix outline-none transition focus:border-vertix focus:ring-2 focus:ring-vertix/15";
const celdaError = "border-red-400 focus:border-red-500 focus:ring-red-100";
const celdaAviso = "border-amber-400 bg-amber-50/50";

const numero = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function LoteForm() {
  const contador = useRef(0);
  const nuevoId = () => `f${++contador.current}`;

  const [modalidad, setModalidad] = useState<ModalidadCheque>("comitente");
  const [instrumento, setInstrumento] = useState<InstrumentoCheque>("echeq");
  const [condicionVendedor, setCondicionVendedor] = useState("ri");
  const [cuitEndosatario, setCuitEndosatario] = useState("");
  const [concertacion, setConcertacion] = useState<Concertacion>("hoy");
  const [filas, setFilas] = useState<Fila[]>(() => [
    filaVacia("f1"),
    filaVacia("f2"),
    filaVacia("f3"),
  ]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campoError, setCampoError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<LoteOutput | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [lecturas, setLecturas] = useState<Lectura[]>([]);
  const [arrastrando, setArrastrando] = useState(false);

  // El contador arranca en 3 porque las tres filas iniciales ya tomaron f1..f3.
  if (contador.current === 0) contador.current = 3;

  const esFce = instrumento === "fce";
  const minFecha = useMemo(
    () =>
      modalidadRequiereMinDias(modalidad)
        ? toISODate(fechaPagoMinima(fechaConcertacion(concertacion)))
        : undefined,
    [modalidad, concertacion]
  );

  const modalidades = MODALIDAD_OPCIONES.filter((m) => {
    const v = m.value as ModalidadCheque;
    if (instrumentoSoloDirecto(instrumento)) return v === "directo";
    if (instrumentoSoloComitente(instrumento)) return v === "comitente";
    return true;
  });

  function cambiarInstrumento(valor: InstrumentoCheque) {
    setInstrumento(valor);
    // El cheque físico no entra al mercado y la FCE sólo se negocia ahí.
    if (instrumentoSoloDirecto(valor)) setModalidad("directo");
    if (instrumentoSoloComitente(valor)) setModalidad("comitente");
  }

  function editar(id: string, campo: keyof Fila, valor: string) {
    setFilas((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const fila = { ...f, [campo]: valor };
        // Corregido a mano, el importe en letras que leyó el lector ya no dice
        // nada: quien edita vio el documento.
        if (campo === "monto") fila.nominal_en_letras = null;
        // El valor aceptado de la FCE se precarga con el 80% del total, que es
        // lo habitual, y deja de recalcularse en cuanto se lo toca a mano.
        if (campo === "monto" && esFce && !f.monto_aceptado) {
          const total = numero(valor);
          fila.monto_aceptado = total ? String(valorAceptadoSugerido(total)) : "";
        }
        return fila;
      })
    );
  }

  const agregar = () =>
    setFilas((prev) =>
      prev.length >= MAX_FILAS_LOTE ? prev : [...prev, filaVacia(nuevoId())]
    );
  const quitar = (id: string) =>
    setFilas((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.id !== id)));

  /**
   * Lee los archivos de a uno y va agregando las filas a medida que llegan.
   * De a uno y no todos juntos porque cada request tiene que quedar lejos del
   * límite de body de Vercel, y porque así la tabla se llena a la vista.
   */
  async function leerArchivos(archivos: File[]) {
    for (const original of archivos) {
      setLecturas((prev) => [...prev, { nombre: original.name, estado: "leyendo" }]);

      const archivo = await comprimirImagen(original);
      const form = new FormData();
      form.append("archivo", archivo);
      const res = await postForm<LecturaResultado>("/api/lote/leer", form);

      const marcar = (estado: Lectura["estado"], detalle?: string) =>
        setLecturas((prev) =>
          prev.map((l, i) =>
            i === prev.length - 1 && l.nombre === original.name
              ? { ...l, estado, detalle }
              : l
          )
        );

      if (!res.success) {
        marcar("error", res.error);
        continue;
      }
      if (res.data.cheques.length === 0) {
        marcar("vacio", res.data.motivo);
        continue;
      }
      agregarLeidos(res.data.cheques);
      marcar(
        "listo",
        `${res.data.cheques.length} ${res.data.cheques.length === 1 ? "cheque" : "cheques"}`
      );
    }
  }

  /** Las filas leídas se suman a la tabla; las vacías que sobran se descartan. */
  function agregarLeidos(leidos: ChequeLeido[]) {
    setFilas((prev) => {
      const cargadas = prev.filter((f) => f.monto || f.fecha_pago || f.cuit_librador);
      const nuevas = leidos.map((c) => ({
        id: nuevoId(),
        monto: c.nominal != null ? String(c.nominal) : "",
        monto_aceptado: "",
        fecha_pago: c.fecha_pago ?? "",
        cuit_librador: c.cuit_librador ?? "",
        banco: c.banco ?? "",
        numero: c.numero ?? "",
        nominal_en_letras: c.nominal_en_letras,
      }));
      return [...cargadas, ...nuevas];
    });
  }

  /**
   * Sólo se revisan las filas que tienen algo cargado: las vacías de abajo son
   * lugar para escribir, no errores.
   */
  const { conDatos, revisiones } = useMemo(() => {
    const cargadas = filas.filter(
      (f) => f.monto || f.fecha_pago || f.cuit_librador || f.numero
    );
    const mapa = new Map<string, RevisionFila>();
    for (const r of revisarFilas(
      cargadas.map((f) => ({
        id: f.id,
        monto: numero(f.monto) ?? null,
        fecha_pago: f.fecha_pago || null,
        cuit_librador: f.cuit_librador || null,
        banco: f.banco || null,
        numero: f.numero || null,
        nominal_en_letras: f.nominal_en_letras,
      }))
    )) {
      mapa.set(r.id, r);
    }
    return { conDatos: cargadas, revisiones: mapa };
  }, [filas]);
  const resumen = resumirRevision([...revisiones.values()]);

  /** Si una celda tiene un aviso de la revisión, o el error que devolvió el server. */
  const avisoDe = (id: string, campo: string) =>
    revisiones.get(id)?.avisos.find((a) => a.campo === campo)?.mensaje;

  /**
   * Clase de una celda: el error que devolvió el server manda sobre el aviso de
   * la revisión, porque es el que impide cotizar.
   * `filas.2.fecha_pago` resalta esa celda y nada más.
   */
  const claseCelda = (id: string, indice: number, campo: string) => {
    if (campoError === `filas.${indice}.${campo}`) return celdaError;
    return avisoDe(id, campo) ? celdaAviso : "";
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCampoError(null);
    setResultado(null);

    if (conDatos.length === 0) {
      setError("Cargá al menos un cheque.");
      return;
    }
    // Una fila a medias no se puede cotizar: falta el importe o el vencimiento.
    if (resumen.incompletas > 0) {
      setError(
        resumen.incompletas === 1
          ? "Hay una fila sin el importe o el vencimiento. Completala o eliminala."
          : `Hay ${resumen.incompletas} filas sin el importe o el vencimiento. Completalas o eliminalas.`
      );
      return;
    }

    setEnviando(true);
    const res = await postJson<LoteOutput>("/api/lote/cotizar", {
      modalidad,
      instrumento,
      condicion_vendedor: condicionVendedor,
      ...(cuitEndosatario ? { cuit_endosatario: cuitEndosatario } : {}),
      concertacion,
      filas: conDatos.map((f) => ({
        id: f.id,
        monto: numero(f.monto) ?? 0,
        ...(esFce && numero(f.monto_aceptado)
          ? { monto_aceptado: numero(f.monto_aceptado) }
          : {}),
        fecha_pago: f.fecha_pago,
        ...(f.cuit_librador ? { cuit_librador: f.cuit_librador } : {}),
        ...(f.banco ? { banco: f.banco } : {}),
        ...(f.numero ? { numero: f.numero } : {}),
      })),
    });
    setEnviando(false);

    if (!res.success) {
      setError(res.error);
      setCampoError(res.field ?? null);
      return;
    }
    setResultado(res.data);
  }

  /** Copia la cotización como columnas separadas por tabulación: se pega en Excel. */
  async function copiar() {
    if (!resultado) return;
    const encabezado = [
      "Banco",
      "Número",
      "CUIT librador",
      "Vencimiento",
      "Nominal",
      "Días",
      "Descuento",
      "A cobrar",
      ...(resultado.totales.a_pagar_comprador != null ? ["Paga el comprador"] : []),
    ];
    const filasTexto = resultado.filas.map((f) =>
      [
        f.banco ?? "",
        f.numero ?? "",
        f.cuit_librador ?? "",
        f.resultado.fecha_acreditacion_estimada,
        f.resultado.monto_negociado,
        f.resultado.dias_considerados,
        f.resultado.descuento_total,
        f.resultado.monto_a_recibir,
        ...(resultado.totales.a_pagar_comprador != null
          ? [f.resultado.comprador?.total_a_pagar ?? ""]
          : []),
      ].join("\t")
    );
    const total = [
      "TOTAL",
      "",
      "",
      "",
      resultado.totales.nominal,
      "",
      resultado.totales.descuento,
      resultado.totales.a_recibir,
      ...(resultado.totales.a_pagar_comprador != null
        ? [resultado.totales.a_pagar_comprador]
        : []),
    ].join("\t");

    try {
      await navigator.clipboard.writeText(
        [encabezado.join("\t"), ...filasTexto, total].join("\n")
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError("El navegador no permitió copiar al portapapeles.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="rounded-xl border border-vertix/10 bg-vertix/[0.02] p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-vertix/60">
          Datos de la tanda
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="Instrumento"
            name="instrumento"
            options={INSTRUMENTO}
            value={instrumento}
            onChange={(e) => cambiarInstrumento(e.target.value as InstrumentoCheque)}
          />
          <Select
            label="Modalidad"
            name="modalidad"
            options={modalidades}
            value={modalidad}
            error={campoError === "modalidad" ? " " : undefined}
            onChange={(e) => setModalidad(e.target.value as ModalidadCheque)}
          />
          <Select
            label="Concertación"
            name="concertacion"
            options={CONCERTACION}
            value={concertacion}
            hint="Desde qué día se cuentan los plazos"
            onChange={(e) => setConcertacion(e.target.value as Concertacion)}
          />
          <Select
            label="Condición del vendedor frente al IVA"
            name="condicion_vendedor"
            options={CONDICION_VENDEDOR}
            value={condicionVendedor}
            onChange={(e) => setCondicionVendedor(e.target.value)}
          />
          <NumberInput
            label="CUIT del vendedor"
            name="cuit_endosatario"
            maxDigits={11}
            value={cuitEndosatario}
            hint="Opcional: si lo cargás se consulta su situación"
            error={campoError === "cuit_endosatario" ? " " : undefined}
            onChange={(e) => setCuitEndosatario(e.target.value)}
          />
        </div>
      </section>

      <section>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            void leerArchivos(Array.from(e.dataTransfer.files));
          }}
          className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
            arrastrando ? "border-vertix bg-vertix/5" : "border-vertix/20"
          }`}
        >
          <p className="text-sm font-medium text-vertix">
            Arrastrá acá los cheques, o el listado que bajaste del banco
          </p>
          <p className="mt-1 text-xs text-vertix/50">
            PDF, imagen, CSV o Excel. Los archivos se leen y se descartan: no se guardan.
          </p>
          <label className="mt-3 inline-block cursor-pointer rounded-md border border-vertix/20 px-3 py-1.5 text-sm font-medium text-vertix transition hover:bg-vertix/5">
            Elegir archivos
            <input
              type="file"
              multiple
              accept=".pdf,.csv,.xlsx,image/*"
              className="hidden"
              onChange={(e) => {
                void leerArchivos(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {lecturas.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs">
            {lecturas.map((l, i) => (
              <li key={`${l.nombre}-${i}`} className="flex items-center gap-2 text-vertix/70">
                <span
                  className={
                    l.estado === "listo"
                      ? "text-emerald-600"
                      : l.estado === "error"
                        ? "text-red-600"
                        : l.estado === "vacio"
                          ? "text-amber-600"
                          : "text-vertix/40"
                  }
                >
                  {l.estado === "listo" ? "✓" : l.estado === "leyendo" ? "…" : "!"}
                </span>
                <span className="font-medium">{l.nombre}</span>
                {l.detalle && <span className="text-vertix/50">— {l.detalle}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-vertix/60">
            Cheques ({filas.length})
          </h2>
          <button
            type="button"
            onClick={agregar}
            disabled={filas.length >= MAX_FILAS_LOTE}
            className="rounded-md border border-vertix/20 px-3 py-1.5 text-sm font-medium text-vertix transition hover:bg-vertix/5 disabled:opacity-40"
          >
            + Agregar cheque
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-vertix/10">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="bg-vertix/[0.04] text-left text-xs uppercase tracking-wide text-vertix/60">
                <th className="px-3 py-2 font-semibold">
                  {esFce ? "Total factura" : "Importe"}
                </th>
                {esFce && <th className="px-3 py-2 font-semibold">Aceptado</th>}
                <th className="px-3 py-2 font-semibold">Vencimiento</th>
                <th className="px-3 py-2 font-semibold">CUIT librador</th>
                <th className="px-3 py-2 font-semibold">Banco</th>
                <th className="px-3 py-2 font-semibold">Nº</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((fila, i) => (
                <tr key={fila.id} className="border-t border-vertix/10">
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      aria-label={`Importe del cheque ${i + 1}`}
                      className={`${celda} ${claseCelda(fila.id, i, "monto")}`}
                      value={fila.monto}
                      onChange={(e) => editar(fila.id, "monto", e.target.value)}
                    />
                  </td>
                  {esFce && (
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        aria-label={`Valor aceptado del cheque ${i + 1}`}
                        className={`${celda} ${claseCelda(fila.id, i, "monto_aceptado")}`}
                        value={fila.monto_aceptado}
                        onChange={(e) => editar(fila.id, "monto_aceptado", e.target.value)}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      min={minFecha}
                      aria-label={`Vencimiento del cheque ${i + 1}`}
                      className={`${celda} ${claseCelda(fila.id, i, "fecha_pago")}`}
                      value={fila.fecha_pago}
                      onChange={(e) => editar(fila.id, "fecha_pago", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      inputMode="numeric"
                      maxLength={11}
                      aria-label={`CUIT del librador del cheque ${i + 1}`}
                      className={`${celda} ${claseCelda(fila.id, i, "cuit_librador")}`}
                      value={fila.cuit_librador}
                      onChange={(e) =>
                        editar(fila.id, "cuit_librador", e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Banco del cheque ${i + 1}`}
                      className={celda}
                      value={fila.banco}
                      onChange={(e) => editar(fila.id, "banco", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`Número del cheque ${i + 1}`}
                      className={`${celda} ${claseCelda(fila.id, i, "numero")}`}
                      value={fila.numero}
                      onChange={(e) => editar(fila.id, "numero", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EstadoCelda revision={revisiones.get(fila.id)} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => quitar(fila.id)}
                      disabled={filas.length <= 1}
                      aria-label={`Eliminar el cheque ${i + 1}`}
                      className="rounded px-2 py-1 text-lg leading-none text-vertix/40 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {modalidadRequiereMinDias(modalidad) && (
          <p className="mt-2 text-xs text-vertix/50">
            En el mercado de capitales el vencimiento tiene que estar al menos a{" "}
            {MIN_DIAS_HABILES} días hábiles, contando el día de la operación.
          </p>
        )}
      </section>

      {resumen.aRevisar > 0 && (
        <Alert tone="warning">
          {resumen.aRevisar === 1
            ? "Hay una fila marcada para revisar."
            : `Hay ${resumen.aRevisar} filas marcadas para revisar.`}{" "}
          Pasá el mouse por el estado de la fila para ver por qué.
        </Alert>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <Button type="submit" disabled={enviando || resumen.incompletas > 0}>
        {enviando ? "Cotizando…" : "Cotizar la tanda"}
      </Button>

      {resultado && <Resultado lote={resultado} onCopiar={copiar} copiado={copiado} />}
    </form>
  );
}

/**
 * El estado de una fila. Lo que importa es que las que probablemente estén mal
 * salten a la vista: una fila correcta no dice nada.
 */
function EstadoCelda({ revision }: { revision?: RevisionFila }) {
  if (!revision || revision.estado === "ok") {
    return <span className="text-xs text-vertix/30">—</span>;
  }
  const incompleta = revision.estado === "incompleta";
  return (
    <span
      title={revision.avisos.map((a) => a.mensaje).join(" ")}
      className={`inline-block cursor-help rounded px-1.5 py-0.5 text-[11px] font-medium ${
        incompleta ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
      }`}
    >
      {incompleta ? "Incompleta" : "Revisar"}
    </span>
  );
}

function BcraChip({ info }: { info: BcraInfo }) {
  const color =
    info.estado === "riesgo"
      ? "bg-red-50 text-red-700"
      : info.estado === "analisis"
        ? "bg-amber-50 text-amber-700"
        : info.estado === "no_verificado"
          ? "bg-vertix/5 text-vertix/50"
          : "bg-emerald-50 text-emerald-700";
  const texto =
    info.estado === "no_verificado"
      ? "BCRA sin respuesta"
      : `Situación ${info.situacion ?? "—"}${info.cheques_rechazados ? " · rechazados" : ""}`;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${color}`} title={info.mensaje}>
      {texto}
    </span>
  );
}

function Resultado({
  lote,
  onCopiar,
  copiado,
}: {
  lote: LoteOutput;
  onCopiar: () => void;
  copiado: boolean;
}) {
  const hayComprador = lote.totales.a_pagar_comprador != null;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-vertix/60">
          Cotización
        </h2>
        <button
          type="button"
          onClick={onCopiar}
          className="rounded-md border border-vertix/20 px-3 py-1.5 text-sm font-medium text-vertix transition hover:bg-vertix/5"
        >
          {copiado ? "Copiado ✓" : "Copiar para Excel"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-vertix/10">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-vertix/[0.04] text-left text-xs uppercase tracking-wide text-vertix/60">
              <th className="px-3 py-2 font-semibold">Cheque</th>
              <th className="px-3 py-2 text-right font-semibold">Nominal</th>
              <th className="px-3 py-2 text-right font-semibold">Días</th>
              <th className="px-3 py-2 text-right font-semibold">Descuento</th>
              <th className="px-3 py-2 text-right font-semibold">A cobrar</th>
              {hayComprador && (
                <th className="px-3 py-2 text-right font-semibold">Paga el comprador</th>
              )}
            </tr>
          </thead>
          <tbody>
            {lote.filas.map((f) => (
              <tr key={f.id} className="border-t border-vertix/10">
                <td className="px-3 py-2">
                  <div className="font-medium text-vertix">
                    {[f.banco, f.numero].filter(Boolean).join(" · ") || "Sin identificar"}
                  </div>
                  <div className="text-xs text-vertix/50">
                    Cobro {f.resultado.fecha_acreditacion_estimada.split("-").reverse().join("/")}
                  </div>
                  {f.bcra && (
                    <div className="mt-1">
                      <BcraChip info={f.bcra} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {ARS2.format(f.resultado.monto_negociado)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {f.resultado.dias_considerados}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-vertix/70">
                  −{ARS2.format(f.resultado.descuento_total)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {ARS2.format(f.resultado.monto_a_recibir)}
                </td>
                {hayComprador && (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {ARS2.format(f.resultado.comprador?.total_a_pagar ?? 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-vertix/20 bg-vertix/[0.04] font-semibold">
              <td className="px-3 py-3">TOTAL ({lote.totales.cantidad})</td>
              <td className="px-3 py-3 text-right tabular-nums">
                {ARS2.format(lote.totales.nominal)}
              </td>
              <td className="px-3 py-3 text-right text-xs font-medium text-vertix/60">
                {lote.totales.costo_total_pct.toFixed(2)}%
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                −{ARS2.format(lote.totales.descuento)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {ARS2.format(lote.totales.a_recibir)}
              </td>
              {hayComprador && (
                <td className="px-3 py-3 text-right tabular-nums">
                  {ARS2.format(lote.totales.a_pagar_comprador ?? 0)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-sm text-vertix/60">
        El cliente cobra <strong className="text-vertix">{ARS.format(lote.totales.a_recibir)}</strong>{" "}
        por {ARS.format(lote.totales.nominal)} de valores, un{" "}
        {lote.totales.costo_total_pct.toFixed(2)}% de costo total.
      </p>

      {lote.bcra_endosatario && lote.bcra_endosatario.estado !== "ok" && (
        <Alert tone="warning">{lote.bcra_endosatario.mensaje}</Alert>
      )}

      {lote.filas.some((f) => f.bcra?.estado === "riesgo") && (
        <Alert tone="warning">
          Hay cheques cuyo librador registra observaciones en el BCRA. La cotización se hizo igual:
          revisá las filas marcadas antes de confirmar la operación.
        </Alert>
      )}
    </section>
  );
}
