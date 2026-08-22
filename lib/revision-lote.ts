import { esCuitValido, normalizarCuit } from "./cuit";
import { diasCalendarioEntre, hoy, parseISODate } from "./fechas";

/**
 * Revisión de la tabla del lote antes de cotizar.
 *
 * El objetivo no es "revisá las diez filas por las dudas" —eso no lo hace
 * nadie— sino **señalar las que probablemente estén mal**. Sólo mira los datos
 * cargados: no depende de tasas ni de red, así que corre en el navegador
 * mientras se tipea.
 */

export type FilaRevisable = {
  id: string;
  monto: number | null;
  fecha_pago: string | null;
  cuit_librador: string | null;
  banco: string | null;
  numero: string | null;
  /** El importe en letras que leyó el lector, cuando el documento lo trae. */
  nominal_en_letras: number | null;
};

export type Aviso = {
  /** Campo al que apunta, para resaltar esa celda. */
  campo: "monto" | "fecha_pago" | "cuit_librador" | "numero";
  mensaje: string;
};

/**
 * `incompleta` no se puede cotizar; `revisar` sí, pero conviene mirarla antes.
 */
export type EstadoFila = "ok" | "revisar" | "incompleta";

export type RevisionFila = {
  id: string;
  estado: EstadoFila;
  avisos: Aviso[];
};

/** Más allá de esto, una fecha de pago es casi seguro un año mal leído. */
const DIAS_MAXIMOS = 360;

export function revisarFilas(
  filas: FilaRevisable[],
  ahora: Date = hoy()
): RevisionFila[] {
  const repetidas = buscarRepetidas(filas);

  return filas.map((fila) => {
    const avisos: Aviso[] = [];
    let incompleta = false;

    if (fila.monto === null || fila.monto <= 0) {
      avisos.push({ campo: "monto", mensaje: "Falta el importe." });
      incompleta = true;
    }

    if (!fila.fecha_pago) {
      avisos.push({ campo: "fecha_pago", mensaje: "Falta el vencimiento." });
      incompleta = true;
    } else {
      const dias = diasCalendarioEntre(ahora, parseISODate(fila.fecha_pago));
      if (dias < 0) {
        avisos.push({ campo: "fecha_pago", mensaje: "El vencimiento ya pasó." });
      } else if (dias > DIAS_MAXIMOS) {
        avisos.push({
          campo: "fecha_pago",
          mensaje: `El vencimiento está a más de ${DIAS_MAXIMOS} días: revisá el año.`,
        });
      }
    }

    // El dígito verificador atrapa casi cualquier dígito mal leído.
    if (fila.cuit_librador && !esCuitValido(normalizarCuit(fila.cuit_librador))) {
      avisos.push({
        campo: "cuit_librador",
        mensaje: "El CUIT no es válido: revisá los 11 dígitos.",
      });
    }

    // La ventaja del cheque en papel es que trae el importe dos veces. Si el
    // modelo leyó mal los dos de la misma forma no se detecta: es el límite del
    // método, no una garantía.
    if (
      fila.monto !== null &&
      fila.nominal_en_letras !== null &&
      Math.abs(fila.monto - fila.nominal_en_letras) > 0.01
    ) {
      avisos.push({
        campo: "monto",
        mensaje: "El importe en números no coincide con el escrito en letras.",
      });
    }

    if (repetidas.has(fila.id)) {
      avisos.push({
        campo: "numero",
        mensaje: "Este cheque parece estar cargado dos veces.",
      });
    }

    return {
      id: fila.id,
      estado: incompleta ? "incompleta" : avisos.length > 0 ? "revisar" : "ok",
      avisos,
    };
  });
}

/**
 * Filas que aparecen más de una vez, por si el mismo archivo se arrastró dos
 * veces: mismo banco y número, o —cuando no hay número— mismo librador, importe
 * y vencimiento.
 */
function buscarRepetidas(filas: FilaRevisable[]): Set<string> {
  const vistas = new Map<string, string[]>();

  for (const fila of filas) {
    const clave = fila.numero
      ? `n:${(fila.banco ?? "").toLowerCase()}|${fila.numero}`
      : fila.cuit_librador && fila.monto !== null && fila.fecha_pago
        ? `d:${fila.cuit_librador}|${fila.monto}|${fila.fecha_pago}`
        : null;
    if (!clave) continue;
    vistas.set(clave, [...(vistas.get(clave) ?? []), fila.id]);
  }

  const repetidas = new Set<string>();
  for (const ids of vistas.values()) {
    if (ids.length > 1) ids.forEach((id) => repetidas.add(id));
  }
  return repetidas;
}

/** Un resumen para decidir si se puede cotizar y qué avisar arriba del botón. */
export function resumirRevision(revisiones: RevisionFila[]) {
  return {
    incompletas: revisiones.filter((r) => r.estado === "incompleta").length,
    aRevisar: revisiones.filter((r) => r.estado === "revisar").length,
  };
}
