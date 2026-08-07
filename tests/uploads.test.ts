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

describe("readUploads — formatos permitidos", () => {
  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const conArchivo = (campo: string, nombre: string, tipo: string) => {
    const fd = new FormData();
    fd.set(campo, new File(["contenido"], nombre, { type: tipo }));
    return fd;
  };

  // AdCap exige la nota impresa y firmada a mano, así que el Word tampoco se
  // acepta acá: sólo el escaneo o la foto.
  it("rechaza el Word en la Nota EPYME", async () => {
    const r = await readUploads(
      conArchivo("nota_epyme_firmada", "nota.docx", DOCX),
      { fileFields: ["nota_epyme_firmada"] }
    );
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toContain("PDF o imagen");
  });

  it("acepta la nota escaneada en PDF", async () => {
    const r = await readUploads(
      conArchivo("nota_epyme_firmada", "nota.pdf", "application/pdf"),
      { fileFields: ["nota_epyme_firmada"] }
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.files.nota_epyme_firmada?.tipo).toBe("application/pdf");
  });

  it("rechaza Word en cualquier otro documento", async () => {
    const r = await readUploads(conArchivo("estatuto", "estatuto.docx", DOCX), {
      fileFields: ["estatuto"],
    });
    expect(r).toHaveProperty("error");
    expect("error" in r && r.error).toContain("PDF o imagen");
  });

  it("nombra los formatos válidos al rechazar otro tipo", async () => {
    const r = await readUploads(
      conArchivo("nota_epyme_firmada", "nota.zip", "application/zip"),
      { fileFields: ["nota_epyme_firmada"] }
    );
    expect("error" in r && r.error).toContain("PDF o imagen");
  });
});
