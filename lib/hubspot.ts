import { logger } from "./logger";

/**
 * HubSpot integration — preparado pero inactivo.
 *
 * Cuando se cree la cuenta de HubSpot:
 * 1. Definir la HUBSPOT_API_KEY en .env (Private App token con scopes
 *    `crm.objects.contacts.write` y `crm.objects.contacts.read`).
 * 2. Quitar el bloque `if (!enabled)` y descomentar la lógica TODO.
 * 3. Mapear los campos extra del formulario a propiedades custom
 *    creadas previamente en HubSpot (servicio, monto_solicitado, etc.).
 */

export type HubspotContactInput = {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  servicio?: string;
  // Cualquier otra propiedad custom mapeada en HubSpot:
  extra?: Record<string, string | number | boolean>;
};

export type HubspotResult =
  | { ok: true; contactId: string }
  | { ok: false; reason: "disabled" | "missing_env" | "network" | "non_2xx"; status?: number };

function isEnabled(): boolean {
  const key = process.env.HUBSPOT_API_KEY;
  return Boolean(key && key.trim());
}

export async function upsertHubspotContact(
  input: HubspotContactInput
): Promise<HubspotResult> {
  if (!isEnabled()) {
    logger.info("hubspot", "Integración inactiva (sin HUBSPOT_API_KEY)", {
      servicio: input.servicio,
    });
    return { ok: false, reason: "disabled" };
  }

  // TODO: activar cuando exista la cuenta de HubSpot.
  // const apiKey = process.env.HUBSPOT_API_KEY!;
  // const [firstName, ...rest] = (input.firstName ?? "").split(" ");
  // const properties: Record<string, string> = {
  //   email: input.email,
  //   firstname: input.firstName ?? "",
  //   lastname: input.lastName ?? rest.join(" ") ?? "",
  //   phone: input.phone ?? "",
  //   company: input.company ?? "",
  //   ...(input.servicio ? { servicio_solicitado: input.servicio } : {}),
  //   ...Object.fromEntries(
  //     Object.entries(input.extra ?? {}).map(([k, v]) => [k, String(v)])
  //   ),
  // };
  //
  // try {
  //   const res = await fetch(
  //     "https://api.hubapi.com/crm/v3/objects/contacts",
  //     {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //         Authorization: `Bearer ${apiKey}`,
  //       },
  //       body: JSON.stringify({ properties }),
  //       cache: "no-store",
  //     }
  //   );
  //
  //   if (!res.ok) {
  //     const status = res.status;
  //     // 409 → contacto existente: actualizar via PATCH /crm/v3/objects/contacts/{id}
  //     logger.error("hubspot", `Respuesta no 2xx al crear contacto`, { status });
  //     return { ok: false, reason: "non_2xx", status };
  //   }
  //
  //   const json = (await res.json()) as { id: string };
  //   return { ok: true, contactId: json.id };
  // } catch (err) {
  //   logger.error("hubspot", "Error de red al crear contacto", {
  //     err: err instanceof Error ? err.message : String(err),
  //   });
  //   return { ok: false, reason: "network" };
  // }

  return { ok: false, reason: "disabled" };
}
