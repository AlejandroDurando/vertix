import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  carpetaDe,
  construirClave,
  enlaceDescarga,
  normalizarNombre,
  storageHabilitado,
  tokenDescarga,
  tokenValido,
} from "@/lib/storage";

const ENV = { ...process.env };

beforeEach(() => {
  process.env.ADJUNTOS_SECRET = "secreto-de-prueba";
  process.env.APP_URL = "https://vertix.com.ar";
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("storageHabilitado", () => {
  it("está apagado si falta cualquiera de las credenciales", () => {
    delete process.env.S3_BUCKET;
    expect(storageHabilitado()).toBe(false);
  });

  it("se enciende con las cuatro variables", () => {
    process.env.S3_BUCKET = "vertix-legajos";
    process.env.S3_ENDPOINT = "https://x.r2.cloudflarestorage.com";
    process.env.S3_ACCESS_KEY_ID = "id";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    expect(storageHabilitado()).toBe(true);
  });
});

describe("normalizarNombre", () => {
  it("saca acentos, espacios y caracteres raros", () => {
    expect(normalizarNombre("Constancia de CBU (año 2026).pdf")).toBe(
      "Constancia-de-CBU-ano-2026-.pdf"
    );
  });

  it("nunca devuelve vacío", () => {
    expect(normalizarNombre("///")).toBe("archivo");
  });

  it("no deja escapar de la carpeta", () => {
    expect(normalizarNombre("../../etc/passwd")).not.toContain("/");
  });
});

describe("construirClave", () => {
  const ID = "3f2a1b7c-1111-4222-8333-444455556666";

  it("agrupa por trámite, fecha e id del envío", () => {
    const clave = construirClave({
      tramite: "alta",
      tramiteId: ID,
      campo: "dni_frente",
      nombre: "foto.jpg",
      fecha: new Date("2026-07-26T12:00:00Z"),
    });
    expect(clave).toBe(`alta/2026-07-26/${ID}/dni_frente-foto.jpg`);
  });

  // Todos los documentos de un envío tienen que caer en la misma carpeta:
  // eso es lo que permite abrir el legajo completo con un solo enlace.
  it("pone los documentos del mismo envío en una carpeta común", () => {
    const base = { tramite: "alta", tramiteId: ID, fecha: new Date("2026-07-26T12:00:00Z") };
    const a = construirClave({ ...base, campo: "dni_frente", nombre: "a.jpg" });
    const b = construirClave({ ...base, campo: "selfie_dni", nombre: "b.jpg" });
    expect(carpetaDe(a)).toBe(carpetaDe(b));
    expect(carpetaDe(a)).toBe(`alta/2026-07-26/${ID}/`);
  });

  it("ignora un id que no sea un UUID", () => {
    const clave = construirClave({
      tramite: "alta",
      tramiteId: "../../otra-carpeta",
      campo: "dni_frente",
      nombre: "foto.jpg",
      fecha: new Date("2026-07-26T12:00:00Z"),
    });
    expect(clave).not.toContain("..");
    expect(clave.split("/")).toHaveLength(4);
  });
});

describe("token de descarga", () => {
  it("acepta el token propio de la clave", () => {
    const clave = "alta/2026-07-26/abc/dni.jpg";
    expect(tokenValido(clave, tokenDescarga(clave))).toBe(true);
  });

  it("rechaza el token de otra clave", () => {
    const token = tokenDescarga("alta/2026-07-26/abc/dni.jpg");
    expect(tokenValido("alta/2026-07-26/xyz/otro.jpg", token)).toBe(false);
  });

  it("rechaza cualquier token si no hay secreto configurado", () => {
    const clave = "alta/2026-07-26/abc/dni.jpg";
    const token = tokenDescarga(clave);
    delete process.env.ADJUNTOS_SECRET;
    expect(tokenValido(clave, token)).toBe(false);
  });

  it("cambia si cambia el secreto del servidor", () => {
    const clave = "alta/2026-07-26/abc/dni.jpg";
    const conUno = tokenDescarga(clave);
    process.env.ADJUNTOS_SECRET = "otro-secreto";
    expect(tokenDescarga(clave)).not.toBe(conUno);
  });
});

describe("firma de URLs", () => {
  // No hay red de por medio: el SDK firma localmente. Sirve para verificar que
  // el cliente queda bien armado contra un endpoint estilo R2.
  it("produce una URL firmada contra el bucket", async () => {
    process.env.S3_BUCKET = "vertix-legajos";
    process.env.S3_ENDPOINT = "https://cuenta.r2.cloudflarestorage.com";
    process.env.S3_ACCESS_KEY_ID = "id-de-prueba";
    process.env.S3_SECRET_ACCESS_KEY = "secreto-de-prueba";

    const { firmarSubida } = await import("@/lib/storage");
    const url = await firmarSubida({
      clave: "alta/2026-07-26/abc/dni.jpg",
      tipo: "image/jpeg",
    });

    expect(url).toContain("cuenta.r2.cloudflarestorage.com");
    expect(url).toContain("vertix-legajos");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=");
  });
});

describe("enlaceDescarga", () => {
  it("apunta al endpoint propio y no al bucket", () => {
    const url = enlaceDescarga("alta/2026-07-26/abc/dni con espacio.jpg");
    expect(url.startsWith("https://vertix.com.ar/api/adjuntos?clave=")).toBe(true);
    expect(url).toContain("token=");
    expect(url).not.toContain(" ");
  });
});
