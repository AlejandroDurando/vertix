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

export type Tasas = {
  cheques: TasasCheques;
  prestamos_ph: number;
  prestamos_pj: number;
  actualizado_el: string;
};

// --- Simulador: cheques ---
export type SimuladorChequesInput = {
  monto: number;
  fecha_pago: string; // YYYY-MM-DD
  modalidad: ModalidadCheque;
  instrumento: InstrumentoCheque;
};

export type BcraEstado = "ok" | "analisis" | "riesgo" | "no_verificado";

export type BcraInfo = {
  cuit: string;
  situacion: number | null;
  cheques_rechazados: boolean;
  estado: BcraEstado;
  mensaje: string;
};

export type SimuladorChequesOutput = {
  monto_a_recibir: number;
  descuento_total: number;
  tna_aplicada: number; // % anual TOTAL (interés + gastos)
  tna_interes: number; // % anual, componente de descuento
  arancel: number; // % anual, gastos de Vertix
  /** Tramo de plazo aplicado, para mostrarlo en el resultado. */
  tramo: string;
  modalidad: ModalidadCheque;
  dias_considerados: number;
  // El comprador se acredita el cheque 2/3 días hábiles después de la fecha de
  // pago; el vendedor cobra el día de la operación.
  fecha_acreditacion_estimada: string; // YYYY-MM-DD (fecha_pago + 2/3 hábiles)
  fecha_acreditacion_vendedor: string; // YYYY-MM-DD (día de la simulación)
  disclaimer: string;
  // Verificación BCRA de los CUIT cargados (siempre presente).
  bcra?: { librador: BcraInfo; endosatario: BcraInfo };
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
  cuota_mensual_desde: number;
  cuota_mensual_hasta: number;
  total_a_pagar_desde: number;
  total_a_pagar_hasta: number;
  total_intereses_desde: number;
  total_intereses_hasta: number;
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
