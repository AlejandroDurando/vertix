import type { ApiResponse } from "@/types";

/**
 * Vercel rechaza los requests cuyo body supera 4,5MB antes de que lleguen al
 * route handler: la respuesta es un 413 que no es JSON. Sin este manejo, el
 * `res.json()` fallaba y el formulario mostraba "no se pudo conectar con el
 * servidor", mandando a la persona a revisar su conexión cuando el problema
 * eran los adjuntos.
 */
const ERROR_413 =
  "Los archivos adjuntos son demasiado pesados para enviarlos juntos. Probá con fotos de menor resolución o subí los documentos en PDF.";

async function leerRespuesta<T>(res: Response): Promise<ApiResponse<T>> {
  if (res.status === 413) {
    return { success: false, error: ERROR_413 };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      success: false,
      error: res.ok
        ? "Recibimos una respuesta inesperada del servidor. Intentá nuevamente."
        : `No pudimos procesar el envío (error ${res.status}). Intentá nuevamente en unos minutos.`,
    };
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return {
      success: false,
      error: "No pudimos leer la respuesta del servidor. Intentá nuevamente.",
    };
  }
}

export async function postJson<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return leerRespuesta<T>(res);
  } catch {
    return { success: false, error: "No se pudo conectar con el servidor." };
  }
}

export async function postForm<T>(url: string, form: FormData): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    return leerRespuesta<T>(res);
  } catch {
    // Un body demasiado grande puede cortar la conexión antes de que haya
    // respuesta, así que se menciona como causa probable.
    return {
      success: false,
      error:
        "No se pudo conectar con el servidor. Si el envío tenía adjuntos pesados, probá con archivos más livianos.",
    };
  }
}
