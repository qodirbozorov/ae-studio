import { describe, expect, it } from "vitest";
import cepConfig from "../cep.config";
import { MIN_AE_VERSION, NS } from "../src/shared/constants";

describe("cep.config", () => {
  it("extension id = ExtendScript namespace", () => {
    expect(cepConfig.id).toBe(NS);
  });

  it("faqat After Effects, CEP 11+ (AE 22.0+)", () => {
    expect(cepConfig.hosts).toEqual([
      { name: "AEFT", version: `[${MIN_AE_VERSION.toFixed(1)},99.9]` },
    ]);
    expect(cepConfig.requiredRuntimeVersion).toBeGreaterThanOrEqual(11);
  });

  it("Node mixed context yoqilgan (§14 manifest talabi)", () => {
    expect(cepConfig.parameters).toEqual(
      expect.arrayContaining(["--enable-nodejs", "--mixed-context"]),
    );
  });

  it("jsxbin o'chiq va ikonkalar berilgan", () => {
    expect(cepConfig.build?.jsxBin).toBe("off");
    expect(cepConfig.zxp.jsxBin).toBe("off");
    expect(cepConfig.iconDarkNormal).toMatch(/^\.\/icons\/.+\.png$/);
  });
});
