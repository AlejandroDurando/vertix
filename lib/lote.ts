import type {
  FilaCotizada,
  LoteInput,
  LoteOutput,
  Tasas,
  TotalesLote,
} from "@/types";
import { hoy } from "./fechas";
import { simularCheques } from "./simulador";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cotiza una tanda de cheques. No hay lógica de negocio nueva: cada fila pasa
 * por `simularCheques()` con los datos comunes del lote, y los totales son la
 * suma de las filas —la misma forma que tiene la fila TOTAL de la planilla
 * "compra CPD PESOS".
 *
 * Función pura y sin BCRA: la consulta es asincrónica y la agrega la ruta,
 * una vez por CUIT distinto y sin frenar el lote.
 */
export function cotizarLote(
  input: LoteInput,
  tasas: Tasas,
  ahora: Date = hoy()
): LoteOutput {
  const filas: FilaCotizada[] = input.filas.map((fila) => ({
    id: fila.id,
    ...(fila.banco ? { banco: fila.banco } : {}),
    ...(fila.numero ? { numero: fila.numero } : {}),
    ...(fila.cuit_librador ? { cuit_librador: fila.cuit_librador } : {}),
    resultado: simularCheques(
      {
        monto: fila.monto,
        ...(fila.monto_aceptado ? { monto_aceptado: fila.monto_aceptado } : {}),
        fecha_pago: fila.fecha_pago,
        modalidad: input.modalidad,
        instrumento: input.instrumento,
        ...(input.condicion_vendedor
          ? { condicion_vendedor: input.condicion_vendedor }
          : {}),
      },
      tasas,
      ahora
    ),
  }));

  return { filas, totales: totalizar(filas) };
}

/**
 * Suma las filas ya cotizadas. Se totaliza sobre lo **negociado** (en la FCE,
 * el valor aceptado), que es la base sobre la que se calculó cada descuento.
 */
export function totalizar(filas: FilaCotizada[]): TotalesLote {
  const suma = (f: (fila: FilaCotizada) => number) =>
    filas.reduce((total, fila) => total + f(fila), 0);

  const nominal = suma((f) => f.resultado.monto_negociado);
  const descuento = suma((f) => f.resultado.descuento_total);

  // Fuera del mercado no existe el bloque del comprador: paga exactamente lo
  // que cobra el vendedor, así que no se informa un total aparte.
  const hayComprador = filas.length > 0 && filas.every((f) => f.resultado.comprador);

  return {
    cantidad: filas.length,
    nominal: round2(nominal),
    a_recibir: round2(suma((f) => f.resultado.monto_a_recibir)),
    descuento: round2(descuento),
    costo_total_pct: nominal > 0 ? round2((descuento / nominal) * 100) : 0,
    ...(hayComprador
      ? { a_pagar_comprador: round2(suma((f) => f.resultado.comprador?.total_a_pagar ?? 0)) }
      : {}),
  };
}
