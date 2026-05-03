import type { ApiResponse } from "@/types";

export async function postJson<T>(url: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: "No se pudo conectar con el servidor." };
  }
}

export async function postForm<T>(url: string, form: FormData): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, { method: "POST", body: form });
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { success: false, error: "No se pudo conectar con el servidor." };
  }
}
