/** P5.04: brand kit compiler'da — default shrift/rang/fon, shrift fallback va AE_FONT_MISSING, subtitr stili, logo. */
import { parseBrand } from "@aes/shared";
import type { Brand } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import type { CompileContext, CompileOutput } from "../src/compile";
import { CONTEXT, spec } from "./fixtures";

function brand(extra: Record<string, unknown> = {}): Brand {
  const parsed = parseBrand({
    slug: "acme",
    name: "Acme",
    colors: { primary: "#1E40AF", accent: "#F59E0B", text: "#FAFAFA", background: "#0B1020" },
    fonts: {
      heading: { family: "Montserrat-Bold", fallback: ["Arial-BoldMT"] },
      body: { family: "Inter-Regular", fallback: ["Roboto-Regular", "ArialMT"] },
    },
    captions: { style: "bold_pop" },
    ...extra,
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.data;
}

const SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  scenes: [
    {
      id: "s1",
      dur: 3,
      layers: [
        { id: "plain", type: "text", text: "Oddiy" },
        {
          id: "custom",
          type: "text",
          text: "Maxsus",
          style: { font: "Georgia", color: "#FF0000" },
        },
      ],
    },
    { id: "s2", dur: 2, bg: "#222222", layers: [{ type: "text", text: "Fon o'zi" }] },
  ],
};

function run(ctx: Partial<CompileContext>, input: unknown = SPEC): CompileOutput {
  const out = compile(spec(input), { ...CONTEXT, ...ctx });
  if (!out.ok) throw new Error(out.error.message);
  return out.data;
}

const style = (out: CompileOutput, id: string) =>
  (out.ops.find((o) => o.op_id === id)!.params as { style: { font?: string; color?: string } })
    .style;

describe("brand kit", () => {
  it("default: body shrifti, matn rangi, sahna foni; aniq berilgani ustun", () => {
    const out = run({ brand: brand() });
    expect(style(out, "s1.plain")).toMatchObject({ font: "Inter-Regular", color: "#FAFAFA" });
    expect(style(out, "s1.custom")).toMatchObject({ font: "Georgia", color: "#FF0000" });
    expect(out.ops.find((o) => o.op_id === "s1.comp")!.params).toMatchObject({ bg: "#0B1020" });
    expect(out.ops.find((o) => o.op_id === "s2.comp")!.params).toMatchObject({ bg: "#222222" });
  });

  it("brand'siz — avvalgidek (shrift yo'q, oq matn, qora fon)", () => {
    const out = run({});
    expect(style(out, "s1.plain")).toEqual(
      expect.not.objectContaining({ font: expect.anything() }),
    );
    expect(style(out, "s1.plain").color).toBe("#FFFFFF");
    expect(out.ops.find((o) => o.op_id === "s1.comp")!.params).toMatchObject({ bg: "#000000" });
  });

  it("AE shriftlari: bor — o'zi; yo'q — fallback (ogohlantirish); hech biri — AE_FONT_MISSING; noma'lum — tekshirilmaydi", () => {
    const all = run({ brand: brand(), fonts: ["Inter-Regular", "Georgia"] });
    expect(style(all, "s1.plain").font).toBe("Inter-Regular");
    expect(all.warnings).toEqual([]);

    const fallback = run({ brand: brand(), fonts: ["ArialMT", "Georgia"] });
    expect(style(fallback, "s1.plain").font).toBe("ArialMT");
    expect(fallback.warnings.join()).toMatch(/Inter-Regular.*ArialMT/);

    const missing = compile(spec(SPEC), { ...CONTEXT, brand: brand(), fonts: ["Georgia"] });
    expect(missing.ok ? null : missing.error).toMatchObject({
      code: "AE_FONT_MISSING",
      details: { font: "Inter-Regular", fallback: ["Roboto-Regular", "ArialMT"] },
    });
    const explicit = compile(spec(SPEC), { ...CONTEXT, fonts: ["ArialMT"] });
    expect(explicit.ok ? null : explicit.error).toMatchObject({
      code: "AE_FONT_MISSING",
      details: { font: "Georgia", fallback: [] },
    });

    expect(style(run({ brand: brand(), fonts: null }), "s1.plain").font).toBe("Inter-Regular");
  });

  it("subtitr stili: Spec'da bo'lmasa brand'dan, bo'lmasa karaoke_bold", () => {
    const withCaptions = {
      ...SPEC,
      audio: {
        voiceover: { kind: "asset", asset: "asset:ding" },
        captions: { from: "voiceover", method: "align" },
      },
    };
    const words = [{ text: "Salom", start: 0, end: 0.5 }];
    const audio = { voiceover: { file: "audio/vo.mp3", words, duration: 1 } };
    const captions = (out: CompileOutput) =>
      (out.ops.find((o) => o.op === "captions.build")!.params as { style: string }).style;
    expect(captions(run({ brand: brand(), audio }, withCaptions))).toBe("bold_pop");
    expect(captions(run({ audio }, withCaptions))).toBe("karaoke_bold");
  });

  it("logo tokeni: asset loyihada yo'q bo'lsa olib tashlanadi (ogohlantirish)", () => {
    const out = run({ brand: brand({ logo: "asset:yoq_logo" }) });
    expect(out.warnings.join()).toMatch(/logo/);
  });
});
