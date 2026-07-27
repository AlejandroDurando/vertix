import { describe, expect, it } from "vitest";
import {
  MAX_TOTAL_BYTES,
  comprimirImagen,
  formatearBytes,
  mensajeExcedido,
} from "@/lib/adjuntos-client";

const archivo = (nombre: string, tipo: string, bytes: number) =>
  new File([new Uint8Array(bytes)], nombre, { type: tipo });

describe("formatearBytes", () => {
  it("usa la unidad legible según el tamaño", () => {
    expect(formatearBytes(512)).toBe("512 B");
    expect(formatearBytes(2048)).toBe("2 KB");
    expect(formatearBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("comprimirImagen", () => {
  // Estos casos no tocan APIs del navegador: se resuelven antes de dibujar.
  it("deja los PDF intactos", async () => {
    const pdf = archivo("estatuto.pdf", "application/pdf", 2 * 1024 * 1024);
    expect(await comprimirImagen(pdf)).toBe(pdf);
  });

  it("deja las imágenes ya livianas intactas", async () => {
    const chica = archivo("dni.jpg", "image/jpeg", 50 * 1024);
    expect(await comprimirImagen(chica)).toBe(chica);
  });

  it("devuelve el original si la compresión falla", async () => {
    // Sin canvas (entorno node) createImageBitmap no existe: debe caer al
    // original en vez de romper el envío del formulario.
    const grande = archivo("dni.jpg", "image/jpeg", 4 * 1024 * 1024);
    expect(await comprimirImagen(grande)).toBe(grande);
  });
});

describe("mensajeExcedido", () => {
  it("nombra los archivos más pesados y el tope", () => {
    const msg = mensajeExcedido({
      total: 6 * 1024 * 1024,
      archivos: [
        { campo: "dni_frente", nombre: "dni.jpg", bytes: 4 * 1024 * 1024 },
        { campo: "estatuto", nombre: "estatuto.pdf", bytes: 2 * 1024 * 1024 },
      ],
    });
    expect(msg).toContain("6.0 MB");
    expect(msg).toContain("dni.jpg (4.0 MB)");
    expect(msg).toContain(formatearBytes(MAX_TOTAL_BYTES));
  });
});
