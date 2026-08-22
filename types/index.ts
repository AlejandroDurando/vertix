export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
};

export type ApiError = {
  success: false;
  error: string;
  field?: string;
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

export type Servicio = "cheques" | "prestamos";
export type TipoPersona = "humana" | "empresa";
export type TipoIngreso = "relacion_dependencia" | "monotributo" | "empresa";
export type TipoPrestamo = "personal" | "prendario";

// Negociación de cheque/echeq/FCE: directo con Vertix o vía cuenta comitente
// (esta última con tasas más bajas).
export type ModalidadCheque = "directo" | "comitente";
export type InstrumentoCheque = "cheque" | "echeq" | "fce";

// Las tasas se interpretan como TNA (Tasa Nominal Anual) expresada en porcentaje.
// Ej.: tasa = 48 → 48% anual. La hoja "tasas" de Google Sheets debe contener
// estos valores anuales.
//
// La tasa que paga el vendedor = tasa de descuento + los gastos de Vertix, y
// las dos dependen de la modalidad y del plazo (confirmado por el cliente el
// 31/07/2026):
//   directo    → hasta 45 días 48% + 2%;  de 46 en adelante 72% + 3,5%
//   comitente  → hasta 30 días 40% + 2,5%; 31 a 60 43% + 2,5%; 61+ 45% + 2,5%
//   comitente FCE → 40% + 2,5%, sin tramos (depende del pagador de la factura)
export type TramoTasa = {
  /** Último día del tramo, inclusive. `null` = sin tope. */
  hastaDias: number | null;
  /** Tasa de descuento, TNA en %. */
  tasa: number;
  /** Gastos/arancel de Vertix, en % anual, que se suman a la tasa. */
  gastos: number;
};

export type TasasCheques = {
  /** Tramos de la operación directa con Vertix, ordenados por plazo. */
  directo: TramoTasa[];
  /** Tramos de la cuenta comitente (echeq), ordenados por plazo. */
  comitente: TramoTasa[];
  /** La FCE en comitente no tiene tramos: es una estimación única. */
  comitenteFce: TramoTasa;
};

/**
 * Costos que se le cobran al vendedor además de la tasa, tomados de la planilla
 * de cotización real ("compra CPD PESOS", 06/08/2026). Todos en %.
 */
export type CostosOperacion = {
  /** IVA general que grava el arancel, los derechos y el interés. */
  iva: number;
  /**
   * IVA sobre los gastos de Vertix fuera del mercado de capitales. Es una fila
   * aparte para poder apagarlo (en 0) sin tocar el IVA del mercado: está a
   * confirmación de Martín (07/08/2026).
   */
  iva_directo: number;
  /** Derechos de mercado del vendedor, prorrateados sobre 90 días. */
  derechos_mercado: number;
  /** Derechos de mercado del **comprador**: la mitad que los del vendedor. */
  derechos_comprador: number;
  /** Arancel que la ALyC le cobra al comprador. Hoy en 0 en la planilla. */
  arancel_comprador: number;
  /** Ingresos Brutos sobre el interés, sólo fuera del mercado de capitales. */
  ingresos_brutos: number;
  /** Impuesto al cheque, sobre el valor nominal (sólo fuera del mercado). */
  impuesto_cheque: number;
  /** Piso del arancel en pesos: AdCap cobra este mínimo si el cálculo da menos. */
  arancel_minimo: number;
};

export type Tasas = {
  cheques: TasasCheques;
  costos: CostosOperacion;
  prestamos_ph: number;
  prestamos_pj: number;
  actualizado_el: string;
};

// --- Simulador: cheques ---
/**
 * Condición frente al IVA de quien vende el cheque. Define si se le cobra la
 * percepción: el monotributista y el consumidor final no la pagan (cliente,
 * 21/08/2026: "se la cobran al vendedor"). Es un dato que quien simula conoce,
 * porque es el suyo; por las dudas se cotiza "ri" —el peor caso— por defecto.
 */
export type CondicionIva = "ri" | "mono_cf";

export type SimuladorChequesInput = {
  /** Valor nominal. En la FCE, el total de la factura. */
  monto: number;
  /**
   * Sólo FCE: parte de la factura que el comprador acepta y que es lo que
   * realmente se negocia (en el ejemplo del cliente, el 80% del total).
   */
  monto_aceptado?: number;
  fecha_pago: string; // YYYY-MM-DD
  modalidad: ModalidadCheque;
  instrumento: InstrumentoCheque;
  condicion_vendedor?: CondicionIva;
};

export type BcraEstado = "ok" | "analisis" | "riesgo" | "no_verificado";

export type BcraInfo = {
  cuit: string;
  situacion: number | null;
  cheques_rechazados: boolean;
  estado: BcraEstado;
  mensaje: string;
};

/** Una línea del desglose de lo que se le descuenta al vendedor, en pesos. */
export type CostoSimulador = {
  concepto: string;
  monto: number;
  /** Detalle del cálculo, para mostrarlo junto al importe. */
  detalle?: string;
};

export type SimuladorChequesOutput = {
  /** Importe sobre el que se cotizó: el nominal, o el aceptado en la FCE. */
  monto_negociado: number;
  monto_a_recibir: number;
  descuento_total: number;
  /** Interés, arancel, IVA, derechos, percepción e impuesto al cheque. */
  costos: CostoSimulador[];
  /** Descuento total como % del valor nominal (incluye impuestos y derechos). */
  costo_total_pct: number;
  tna_aplicada: number; // % anual TOTAL (interés + gastos)
  tna_interes: number; // % anual, componente de descuento
  arancel: number; // % anual, gastos de Vertix
  /** Si el resultado incluye la percepción de IVA (comprador RI). */
  incluye_percepcion: boolean;
  /** Tramo de plazo aplicado, para mostrarlo en el resultado. */
  tramo: string;
  modalidad: ModalidadCheque;
  dias_considerados: number;
  // El comprador se acredita el cheque 2/3 días hábiles después de la fecha de
  // pago; el vendedor cobra el día de la operación.
  fecha_acreditacion_estimada: string; // YYYY-MM-DD (fecha_pago + 2/3 hábiles)
  fecha_acreditacion_vendedor: string; // YYYY-MM-DD (día de la simulación)
  disclaimer: string;
  /**
   * Lo que tiene que poner quien compra el cheque, que a veces es Vertix y a
   * veces un inversor externo. Es el bloque COMPRADOR de la planilla y sólo
   * existe en el mercado de capitales; el simulador público no lo muestra.
   */
  comprador?: CotizacionComprador;
  // Verificación BCRA de los CUIT cargados (siempre presente).
  bcra?: { librador: BcraInfo; endosatario: BcraInfo };
};

export type CotizacionComprador = {
  costos: CostoSimulador[];
  /** Lo que desembolsa el comprador. */
  total_a_pagar: number;
  /** Lo que separa ese desembolso de lo que termina cobrando el vendedor. */
  diferencia_con_vendedor: number;
};

// --- Cotización en lote ---
// El equipo recibe tandas de cheques de un mismo cliente y hoy los carga uno
// por uno. El lote comparte todo lo que no cambia entre cheques (vendedor,
// modalidad, instrumento) y sólo repite por fila lo propio de cada valor.

/** Un cheque de la tanda, tal como queda en la tabla antes de cotizar. */
export type FilaLote = {
  /** Identificador que pone el navegador, para casar la fila con su resultado. */
  id: string;
  /** Valor nominal. En la FCE, el total de la factura. */
  monto: number;
  /** Sólo FCE: la parte que el comprador aceptó, que es lo que se negocia. */
  monto_aceptado?: number;
  fecha_pago: string; // YYYY-MM-DD
  /** Quien firma el cheque: es a quien se le consulta el BCRA. */
  cuit_librador?: string;
  banco?: string;
  /** Número de cheque, para detectar el mismo valor cargado dos veces. */
  numero?: string;
};

export type LoteInput = {
  modalidad: ModalidadCheque;
  instrumento: InstrumentoCheque;
  condicion_vendedor?: CondicionIva;
  /** Quien vende la tanda. Uno solo para todo el lote. */
  cuit_endosatario?: string;
  filas: FilaLote[];
};

export type FilaCotizada = {
  id: string;
  banco?: string;
  numero?: string;
  cuit_librador?: string;
  resultado: SimuladorChequesOutput;
  /**
   * Situación del librador en el BCRA, cuando la fila trae CUIT. A diferencia
   * del simulador de a uno, acá **nunca** frena la cotización: marca la fila y
   * el resto del lote se cotiza igual.
   */
  bcra?: BcraInfo;
};

export type TotalesLote = {
  cantidad: number;
  /** Suma de lo que se negocia: el nominal, o el aceptado en la FCE. */
  nominal: number;
  a_recibir: number;
  descuento: number;
  /** Descuento total como % de lo negociado. */
  costo_total_pct: number;
  /** Lo que desembolsa el comprador. Sólo en el mercado de capitales. */
  a_pagar_comprador?: number;
};

export type LoteOutput = {
  filas: FilaCotizada[];
  totales: TotalesLote;
  /** Situación del vendedor, si se cargó su CUIT. Sólo informativa. */
  bcra_endosatario?: BcraInfo;
};

// --- Simulador: préstamos ---
// La tasa final depende del solicitante y de condiciones de mercado (cauciones,
// intereses bancarios), no del tipo de persona: el simulador muestra un RANGO
// entre las dos tasas cargadas en la hoja (prestamos_ph y prestamos_pj actúan
// como extremos del rango).
export type SimuladorPrestamosInput = {
  monto: number;
  plazo_meses: number;
};

export type SimuladorPrestamosOutput = {
  /** Cuota fija: el total repartido en partes iguales, IVA incluido. */
  cuota_mensual_desde: number;
  cuota_mensual_hasta: number;
  total_a_pagar_desde: number;
  total_a_pagar_hasta: number;
  total_intereses_desde: number;
  total_intereses_hasta: number;
  /** IVA sobre los intereses (21%), que también se reparte en las cuotas. */
  total_iva_desde: number;
  total_iva_hasta: number;
  tna_desde: number; // % anual
  tna_hasta: number; // % anual
  disclaimer: string;
};

// --- Contacto ---
export type ContactoData = {
  nombre: string;
  email: string;
  telefono: string;
  empresa?: string;
  asunto: string;
  mensaje: string;
};

// --- Precalificación ---
export type PrecalificacionChequesData = {
  servicio: "cheques";
  nombre: string;
  email: string;
  telefono: string;
  empresa: string; // PF: "Titular" o nombre
  instrumento: InstrumentoCheque;
  monto_cheque: number;
  fecha_pago: string;
  banco_emisor: string;
  cuit_librador: string;
  cuit_endosatario: string;
};

export type PrecalificacionPrestamosData = {
  servicio: "prestamos";
  nombre: string;
  email: string;
  telefono: string;
  tipo_persona: TipoPersona;
  tipo_prestamo: TipoPrestamo;
  cuit_solicitante: string;
  monto_solicitado: number;
  plazo_meses: number;
  tipo_ingreso: TipoIngreso;
};

export type PrecalificacionData =
  | PrecalificacionChequesData
  | PrecalificacionPrestamosData;

// El alta de cuenta comitente (AdCap / Sailing) tipa sus datos directamente
// desde los esquemas zod en lib/validations.ts (AltaInput).
export type Alyc = "adcap" | "sailing";
export type TipoAlta = "fisica" | "juridica";
