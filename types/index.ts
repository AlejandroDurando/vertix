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

export type TasaServicio =
  | "cheques_directo"
  | "cheques_comitente"
  | "prestamos_ph"
  | "prestamos_pj";

// Las tasas se interpretan como TNA (Tasa Nominal Anual) expresada en porcentaje.
// Ej.: cheques_directo = 48 → 48% anual. La hoja "tasas" de Google Sheets debe
// contener estos valores anuales.
// La tasa total de cheques = tasa de descuento (variable) + arancel de la
// empresa (hoy 2,5%, no suele variar). Se cargan por separado para que los
// dueños ajusten la tasa sin tocar el arancel.
export type Tasas = {
  cheques_directo: number;
  cheques_comitente: number;
  arancel_cheques: number;
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
  tna_aplicada: number; // % anual TOTAL (interés + arancel)
  tna_interes: number; // % anual, componente de descuento (variable)
  arancel: number; // % anual, arancel de la empresa (fijo)
  modalidad: ModalidadCheque;
  dias_considerados: number;
  fecha_acreditacion_estimada: string; // YYYY-MM-DD (fecha_pago + 2/3 hábiles)
  disclaimer: string;
  // Verificación BCRA de los CUIT cargados (siempre presente).
  bcra?: { librador: BcraInfo; endosatario: BcraInfo };
};

// --- Simulador: préstamos ---
export type SimuladorPrestamosInput = {
  monto: number;
  plazo_meses: number;
  tipo_persona: TipoPersona;
};

export type SimuladorPrestamosOutput = {
  cuota_mensual: number;
  total_a_pagar: number;
  total_intereses: number;
  tna_aplicada: number; // % anual
  tasa_mensual: number; // % mensual
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
