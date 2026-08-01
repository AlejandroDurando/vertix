/**
 * Datos de contacto de Vertix, usados en las leyendas que invitan a llamar
 * cuando la web no puede resolver el caso por sí sola.
 */

/** Número de Martín, confirmado por el cliente el 31/07/2026. */
export const TELEFONO = "11 5099-8356";

/** Mismo número en formato internacional, sin separadores, para el enlace. */
const TELEFONO_E164 = "5491150998356";

export const WHATSAPP_URL = `https://wa.me/${TELEFONO_E164}`;
export const TELEFONO_URL = `tel:+${TELEFONO_E164}`;
