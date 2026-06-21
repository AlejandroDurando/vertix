/**
 * Validación y normalización de CUIT/CUIL argentino.
 * Verifica los 11 dígitos y el dígito verificador (módulo 11).
 */

const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Deja sólo los dígitos (acepta entrada con guiones, espacios, etc.). */
export function normalizarCuit(input: string): string {
  return (input ?? "").replace(/\D/g, "");
}

export function esCuitValido(input: string): boolean {
  const cuit = normalizarCuit(input);
  if (cuit.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cuit)) return false; // todos iguales

  const digitos = cuit.split("").map(Number);
  const suma = MULTIPLICADORES.reduce((acc, mult, i) => acc + mult * digitos[i], 0);
  const resto = suma % 11;
  let verificador = 11 - resto;
  if (verificador === 11) verificador = 0;
  if (verificador === 10) verificador = 9;
  return verificador === digitos[10];
}

/** Formatea como XX-XXXXXXXX-X si tiene 11 dígitos; si no, devuelve el original. */
export function formatearCuit(input: string): string {
  const cuit = normalizarCuit(input);
  if (cuit.length !== 11) return input;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}
