/** P5.01: shablonli sahnalar — recipe yoyilishi va aep `template.instantiate`. */
import { parseOpEnvelope, parseTemplateManifest } from "@aes/shared";
import type { TemplateManifest } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import type { CompileContext } from "../src/compile";
import { brandTokens } from "../src/template";
import { CONTEXT, spec } from "./fixtures";

function manifest(input: unknown): TemplateManifest {
  const parsed = parseTemplateManifest(input);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.data;
}

const RECIPE = manifest({
  slug: "hook_title",
  source: "recipe",
  duration: { min: 1.5, max: 6 },
  formats: ["9:16", "1:1"],
  bg: "{{brand.background}}",
  slots: {
    title: { type: "text", max_chars: 20 },
    subtitle: { type: "text", default: "" },
    bg: { type: "media", fit: "cover" },
    accent: { type: "color", default: "#FF0055" },
  },
  layers: [
    { type: "media", src: "{{bg}}", anim: "ken_burns_in" },
    { type: "shape", kind: "rect", color: "{{accent}}", size: { w: 0.7, h: 0.012 }, pos: "center" },
    {
      id: "title",
      type: "text",
      text: "{{title}}",
      anim: "pop",
      style: { font: "{{brand.heading_font}}", size: 110, color: "{{brand.text}}" },
    },
    { if: "subtitle", type: "text", text: "— {{subtitle}} —", pos: "lower_third" },
  ],
});

const AEP = manifest({
  slug: "promo",
  comp: "PROMO",
  duration: { min: 2, max: 8, stretch: "time_remap" },
  formats: ["9:16"],
  slots: {
    title: { type: "text", layer: "TITLE" },
    bg: { type: "media", layer: "BG_PLACEHOLDER", fit: "contain" },
    accent: { type: "color", egp: "Accent Color", default: "#00AAFF" },
  },
});

function ctx(extra: Partial<CompileContext> = {}): CompileContext {
  return {
    ...CONTEXT,
    templates: {
      hook_title: { manifest: RECIPE, version: 1 },
      promo: { manifest: AEP, version: 3, file: "templates/promo_v3.aep" },
    },
    ...extra,
  };
}

function reel(scene: Record<string, unknown>) {
  return spec({
    version: 1,
    format: { w: 1080, h: 1920, fps: 30 },
    output: { name: "tpl" },
    scenes: [scene, { id: "end", dur: 1, layers: [{ type: "text", text: "Oxiri" }] }],
  });
}

function compiled(scene: Record<string, unknown>, c = ctx()) {
  const result = compile(reel(scene), c);
  if (!result.ok) throw new Error(result.error.message);
  for (const op of result.data.ops) {
    const parsed = parseOpEnvelope(op);
    if (!parsed.ok) throw new Error(`${op.op_id}: ${parsed.error.message}`);
  }
  return result.data;
}

function error(scene: Record<string, unknown>, c = ctx()) {
  const result = compile(reel(scene), c);
  return result.ok ? null : result.error;
}

describe("recipe shablon", () => {
  it("slotlar o'rniga qo'yiladi, layerlar shablon op_id'lari bilan, sahna layerlari ustida", () => {
    const out = compiled({
      id: "s1",
      dur: 3,
      template: "hook_title",
      slots: { title: "3 ta xato", bg: "asset:clip_01" },
      layers: [{ id: "badge", type: "text", text: "YANGI", pos: "top" }],
    });
    const scene = out.ops.filter((o) => o.scene_id === "s1").map((o) => o.op_id);
    expect(scene).toEqual(
      expect.arrayContaining(["s1.tpl.l0", "s1.tpl.l1", "s1.tpl.title", "s1.badge"]),
    );
    expect(scene.indexOf("s1.tpl.title")).toBeLessThan(scene.indexOf("s1.badge"));
    // `if: subtitle` — bo'sh slot → layer yo'q.
    expect(scene).not.toContain("s1.tpl.l3");
    const title = out.ops.find((o) => o.op_id === "s1.tpl.title")!;
    expect(title.params).toMatchObject({ text: "3 ta xato" });
    // Brand berilmagan: font/rang tokenlari olib tashlanadi (default qoladi).
    expect((title.params as { style: { font?: string } }).style.font).toBeUndefined();
    expect(out.ops.find((o) => o.op_id === "s1.tpl.l1")!.params).toMatchObject({
      color: "#FF0055",
    });
    expect(out.ops.find((o) => o.op_id === "s1.tpl.l0")!.params).toMatchObject({
      item: "asset.clip_01",
    });
    expect(out.ops.find((o) => o.op_id === "asset.clip_01")).toBeDefined();
  });

  it("brand tokenlari: font, rang, fon; matn ichidagi slot", () => {
    const tokens = brandTokens({
      slug: "acme",
      name: "Acme",
      colors: { primary: "#112233", text: "#FAFAFA", background: "#0A0A0A" },
      fonts: {
        heading: { family: "Montserrat-Bold", fallback: [] },
        body: { family: "Inter", fallback: [] },
      },
      captions: { style: "bold_pop" },
    });
    const out = compiled(
      {
        id: "s1",
        dur: 3,
        template: "hook_title",
        slots: { title: "Salom", subtitle: "Acme", bg: "asset:clip_01" },
      },
      ctx({ tokens }),
    );
    expect(out.ops.find((o) => o.op_id === "s1.tpl.title")!.params).toMatchObject({
      style: { font: "Montserrat-Bold", color: "#FAFAFA" },
    });
    expect(out.ops.find((o) => o.op_id === "s1.tpl.l3")!.params).toMatchObject({
      text: "— Acme —",
    });
    expect(out.ops.find((o) => o.op_id === "s1.comp")!.params).toMatchObject({ bg: "#0A0A0A" });
  });

  it("xatolar: majburiy slot, noma'lum slot, max_chars, noto'g'ri media, noma'lum asset", () => {
    const base = { id: "s1", dur: 3, template: "hook_title" };
    expect(error({ ...base, slots: { bg: "asset:clip_01" } })).toMatchObject({
      code: "SPEC_INVALID",
      message: expect.stringContaining("/scenes/0/slots/title"),
    });
    expect(
      error({ ...base, slots: { title: "x", bg: "asset:clip_01", logo: "asset:clip_01" } }),
    ).toMatchObject({ code: "SPEC_INVALID", message: expect.stringContaining("slots/logo") });
    expect(error({ ...base, slots: { title: "x".repeat(21), bg: "asset:clip_01" } })).toMatchObject(
      { code: "SPEC_INVALID", message: expect.stringContaining("21 belgi") },
    );
    expect(error({ ...base, slots: { title: "x", bg: "clip_01" } })).toMatchObject({
      code: "SPEC_INVALID",
    });
    expect(error({ ...base, slots: { title: "x", bg: "asset:yoq" } })).toMatchObject({
      code: "SPEC_UNKNOWN_ASSET",
    });
    expect(error({ ...base, template: "nope", slots: {} })).toMatchObject({
      code: "SPEC_UNKNOWN_TEMPLATE",
    });
  });

  it("format va davomiylik mos kelmasa ogohlantirish", () => {
    const out = compile(
      spec({
        version: 1,
        format: { w: 1920, h: 1080, fps: 30 },
        scenes: [
          { id: "s1", dur: 9, template: "hook_title", slots: { title: "x", bg: "asset:clip_01" } },
        ],
      }),
      ctx(),
    );
    expect(out.ok && out.data.warnings.join("\n")).toMatch(/16:9[\s\S]*1\.5–6/);
  });
});

describe("aep shablon", () => {
  it("template.instantiate: slot bog'lanishlari, asset importi, sahna davomiyligi", () => {
    const out = compiled({
      id: "s1",
      dur: 4,
      template: "promo",
      slots: { title: "Chegirma!", bg: "asset:photo_02" },
    });
    const op = out.ops.find((o) => o.op_id === "s1.tpl")!;
    expect(op).toMatchObject({
      op: "template.instantiate",
      scene_id: "s1",
      params: {
        template: "promo",
        version: 3,
        file: "templates/promo_v3.aep",
        template_comp: "PROMO",
        comp: "s1.comp",
        start: 0,
        dur: 4,
        stretch: "time_remap",
        slots: [
          { type: "text", layer: "TITLE", text: "Chegirma!" },
          { type: "media", layer: "BG_PLACEHOLDER", item: "asset.photo_02", fit: "contain" },
          { type: "color", egp: "Accent Color", color: "#00AAFF" },
        ],
      },
    });
    const ids = out.ops.map((o) => o.op_id);
    expect(ids.indexOf("asset.photo_02")).toBeLessThan(ids.indexOf("s1.tpl"));
  });

  it("aep fayli yo'q → SPEC_UNKNOWN_TEMPLATE", () => {
    const c = ctx();
    c.templates!.promo = { manifest: AEP, version: 3 };
    expect(
      error(
        { id: "s1", dur: 4, template: "promo", slots: { title: "x", bg: "asset:photo_02" } },
        c,
      ),
    ).toMatchObject({
      code: "SPEC_UNKNOWN_TEMPLATE",
    });
  });
});
