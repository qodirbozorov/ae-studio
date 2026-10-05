/**
 * P5.03: boshlang'ich kutubxona — har shablon manifestidagi har formatda (brand bilan va brand'siz)
 * kompilyatsiya qilinadi va oplar haqiqiy ES3 bundle'da mock AE'da bajariladi; matnlar kadrga sig'adi.
 */
import { brandTokens, compile } from "@aes/compiler";
import type { CompileAsset } from "@aes/compiler";
import { parseBrand, parseOpEnvelope, parseSpec } from "@aes/shared";
import type { Aspect, TemplateManifest } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "../../server/src/templates/library";
import { ASPECT_FRAMES } from "../../server/src/templates/apply";
import { createMockAE } from "./ae-mock";
import type { CompItem } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

const ROOT = "D:/Projects/tpl";
const ASSETS: Record<string, CompileAsset> = {
  photo: {
    key: "photo",
    local_path: "source/photo.jpg",
    kind: "image",
    meta: { width: 1200, height: 1600 },
  },
  clip: {
    key: "clip",
    local_path: "source/clip.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 20 },
  },
  logo: {
    key: "logo",
    local_path: "source/logo.png",
    kind: "image",
    meta: { width: 512, height: 512 },
  },
};

const brand = parseBrand({
  slug: "acme",
  name: "Acme",
  colors: { primary: "#1E40AF", accent: "#F59E0B", text: "#FFFFFF", background: "#0B1020" },
  fonts: {
    heading: { family: "Montserrat-Bold", fallback: ["Arial-BoldMT"] },
    body: { family: "Inter-Regular", fallback: ["ArialMT"] },
  },
  logo: "asset:logo",
});

/** Har slot uchun to'liq qiymat: matn — chegarasigacha, media — rasm/video. */
function fullSlots(manifest: TemplateManifest): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [name, slot] of Object.entries(manifest.slots)) {
    if (slot.type === "text") {
      const sample = "Namuna matn uzunroq bo'lishi mumkin va kadrga sig'ishi kerak bo'ladi";
      slots[name] = sample.slice(0, slot.max_chars ?? 24).trim();
    } else if (slot.type === "media") slots[name] = name === "bg" ? "asset:clip" : "asset:photo";
  }
  return slots;
}

function cases(): [string, Aspect, boolean][] {
  const out: [string, Aspect, boolean][] = [];
  for (const m of BUILTIN_TEMPLATES) {
    for (const format of m.formats) {
      out.push([m.slug, format, true]);
      out.push([m.slug, format, false]);
    }
  }
  return out;
}

describe("boshlang'ich shablon kutubxonasi", () => {
  it("kamida 5 ta shablon, hammasi 3 formatda (M7)", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(BUILTIN_TEMPLATES.map((m) => m.slug)).toEqual(
      expect.arrayContaining([
        "hook_title",
        "lower_third",
        "cta_outro",
        "product_showcase",
        "testimonial",
        "top3_list",
      ]),
    );
    for (const m of BUILTIN_TEMPLATES) {
      expect(m.formats, m.slug).toEqual(["9:16", "1:1", "16:9"]);
      expect(m.title, m.slug).toBeTruthy();
    }
  });

  it.each(cases())(
    "%s · %s · brand=%s: kompilyatsiya + AE'da bajariladi",
    async (slug, format, withBrand) => {
      if (!brand.ok) throw new Error(brand.error.message);
      const manifest = BUILTIN_TEMPLATES.find((m) => m.slug === slug)!;
      const frame = ASPECT_FRAMES[format];
      const dur = Math.min(manifest.duration.max, Math.max(manifest.duration.min, 4));
      // Brand'siz holatda ixtiyoriy slotlar bo'sh (default) qoladi.
      const slots = withBrand
        ? fullSlots(manifest)
        : Object.fromEntries(
            Object.entries(fullSlots(manifest)).filter(
              ([n]) => manifest.slots[n]!.default === undefined,
            ),
          );
      const spec = parseSpec({
        version: 1,
        format: { ...frame, fps: 30 },
        output: { name: `${slug}_${format.replace(":", "x")}` },
        scenes: [{ id: "s1", dur, template: slug, slots }],
      });
      if (!spec.ok) throw new Error(spec.error.message);
      const out = compile(spec.data, {
        assets: ASSETS,
        projectPath: "tpl_v001.aep",
        version: 1,
        templates: { [slug]: { manifest, version: 1 } },
        ...(withBrand ? { tokens: brandTokens(brand.data) } : {}),
      });
      if (!out.ok) throw new Error(out.error.message);
      expect(out.data.warnings).toEqual([]);

      for (const op of out.data.ops) {
        const parsed = parseOpEnvelope(op);
        expect(parsed.ok, `${op.op_id}: ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
        // Matn kadrda: nuqtali bo'lsa taxminiy eni, quti bo'lsa quti eni kadr ichida.
        if (op.op === "layer.add_text") {
          const p = op.params as {
            text: string;
            pos: [number, number];
            box?: [number, number];
            style: { size?: number };
          };
          const half = (p.box?.[0] ?? p.text.length * (p.style.size ?? 80) * 0.55) / 2;
          expect(p.pos[0] - half, `${op.op_id} chap`).toBeGreaterThanOrEqual(-1);
          expect(p.pos[0] + half, `${op.op_id} o'ng`).toBeLessThanOrEqual(frame.w + 1);
          expect(p.pos[1], `${op.op_id} y`).toBeLessThan(frame.h);
        }
      }
      const fonts = out.data.ops
        .filter((o) => o.op === "layer.add_text")
        .map((o) => (o.params as { style: { font?: string } }).style.font);
      if (withBrand)
        expect(fonts.every((f) => f === "Montserrat-Bold" || f === "Inter-Regular")).toBe(true);
      else expect(fonts.every((f) => f === undefined)).toBe(true);

      const ae = createMockAE({
        files: {
          [`${ROOT}/source/photo.jpg`]: { width: 1200, height: 1600 },
          [`${ROOT}/source/clip.mp4`]: { width: 1920, height: 1080, duration: 20, frameRate: 30 },
          [`${ROOT}/source/logo.png`]: { width: 512, height: 512 },
        },
      });
      const h = await loadJsx(ae);
      for (const op of out.data.ops) {
        const res = h.run(op.op, op.op_id, op.params as never, { root: ROOT });
        expect(res.ok, `${op.op_id}: ${JSON.stringify(res)}`).toBe(true);
      }
      const scene = ae.app.project.itemsList.find((i) => i.name === "01_s1") as CompItem;
      expect(scene.width).toBe(frame.w);
      expect(scene.layersList.length).toBeGreaterThanOrEqual(2);
    },
  );
});
