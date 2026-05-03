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
export type TipoCheque = "propio" | "tercero";
export type TipoIngreso = "relacion_dependencia" | "monotributo" | "empresa";

export type TasaServicio = "cheques" | "prestamos_ph" | "prestamos_pj";

export type Tasas = {
  cheques: number;
  prestamos_ph: number;
  prestamos_pj: number;
  actualizado_el: string;
};

export type SimuladorChequesInput = {
  monto: number;
  dias_vencimiento: number;
};

export type SimuladorChequesOutput = {
  monto_a_recibir: number;
  descuento_total: number;
  tasa_aplicada: number;
  disclaimer: string;
};

export type SimuladorPrestamosInput = {
  monto: number;
  plazo_meses: number;
  tipo_persona: TipoPersona;
};

export type SimuladorPrestamosOutput = {
  cuota_mensual: number;
  total_a_pagar: number;
  total_intereses: number;
  tasa_aplicada: number;
  disclaimer: string;
};

export type ContactoData = {
  nombre: string;
  email: string;
  telefono: string;
  empresa?: string;
  asunto: string;
  mensaje: string;
};

export type PrecalificacionChequesData = {
  servicio: "cheques";
  nombre: string;
  email: string;
  telefono: string;
  empresa: string;
  monto_cheque: number;
  fecha_vencimiento: string;
  banco_emisor: string;
  tipo_cheque: TipoCheque;
};

export type PrecalificacionPrestamosData = {
  servicio: "prestamos";
  nombre: string;
  email: string;
  telefono: string;
  tipo_persona: TipoPersona;
  monto_solicitado: number;
  plazo_meses: number;
  tipo_ingreso: TipoIngreso;
  archivo?: {
    nombre: string;
    tipo: string;
    tamano: number;
  };
};

export type PrecalificacionData =
  | PrecalificacionChequesData
  | PrecalificacionPrestamosData;
