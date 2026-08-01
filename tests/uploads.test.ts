import { describe, expect, it } from "vitest";
import { readUploads } from "@/lib/uploads";

const form = (pares: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(pares)) fd.set(k, v);
  return fd;
};

describe("readUploads — referencias a archivos ya subidos al bucket", () => {
  it("junta la clave y el nombre en un solo documento", async () => {
    const r = await readUploads(
      form({
        tipo: "juridica",
        estatuto__clave: "alta/2026-08-01/abc/estatuto.pdf",
        estatuto__nombre: "estatuto.pdf",
      }),
      { fileFields: ["estatuto"] }
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.subidos.estatuto).toEqual({
      clave: "alta/2026-08-01/abc/estatuto.pdf",
      nombre: "estatuto.pdf",
    });
  });

  it("no mete las referencias entre los campos de datos", async () => {
    const r = await readUploads(
      form({ tipo: "juridica", estatuto__clave: "x", estatuto__nombre: "y" }),
      { fileFields: ["estatuto"] }
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.data).toEqual({ tipo: "juridica" });
  });

  it("ignora referencias de campos que no son de archivo", async () => {
    const r = await readUploads(form({ cualquiera__clave: "x" }), {
      fileFields: ["estatuto"],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.subidos).toEqual({});
  });

  // Una referencia sin clave no sirve: debe tratarse como documento faltante.
  it("descarta una referencia que sólo trae el nombre", async () => {
    const r = await readUploads(form({ estatuto__nombre: "estatuto.pdf" }), {
      fileFields: ["estatuto"],
    });
    if ("error" in r) throw new Error(r.error);
    expect(r.subidos).toEqual({});
  });
});
