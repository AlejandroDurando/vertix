import { describe, expect, it } from "vitest";
import { evaluarBcra, infoBcra, type BcraResultado } from "@/lib/bcra";

const resultado = (over: Partial<BcraResultado> = {}): BcraResultado => ({
  disponible: true,
  cuit: "20123456786",
  situacionMaxima: 1,
  tieneChequesRechazados: false,
  chequesRechazadosImpagos: false,
  ...over,
});

describe("evaluarBcra", () => {
  it("bloquea situación 3 o superior", () => {
    expect(evaluarBcra(resultado({ situacionMaxima: 3 })).decision).toBe("bloquear");
    expect(evaluarBcra(resultado({ situacionMaxima: 5 })).decision).toBe("bloquear");
  });

  it("advierte con situación 2 o cheques rechazados impagos", () => {
    expect(evaluarBcra(resultado({ situacionMaxima: 2 })).decision).toBe("advertir");
    expect(
      evaluarBcra(resultado({ chequesRechazadosImpagos: true })).decision
    ).toBe("advertir");
  });

  it("permite si el BCRA no respondió (fail-open)", () => {
    expect(evaluarBcra(resultado({ disponible: false })).decision).toBe("permitir");
  });
});

describe("infoBcra", () => {
  it("marca riesgo para el librador en situación 3+", () => {
    const info = infoBcra(resultado({ situacionMaxima: 4 }), "El librador");
    expect(info.estado).toBe("riesgo");
  });

  // El endosatario nunca traba el presupuesto: quien paga el cheque es el
  // librador, así que su situación se informa como "requiere análisis previo".
  it("degrada a análisis para el endosatario en situación 3+", () => {
    const info = infoBcra(resultado({ situacionMaxima: 4 }), "El endosatario", {
      soloInformativo: true,
    });
    expect(info.estado).toBe("analisis");
    expect(info.mensaje).toContain("Requiere análisis previo");
  });

  it("no altera un endosatario sin observaciones", () => {
    const info = infoBcra(resultado(), "El endosatario", { soloInformativo: true });
    expect(info.estado).toBe("ok");
  });
});
