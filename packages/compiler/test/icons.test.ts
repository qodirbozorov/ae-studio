/** Ikonkalar: native shape (as_shapes) geometriyasi — o'lcham, markaz, chiziq qalinligi — va PDF footage yo'li. */
import { parseOpEnvelope } from "@aes/shared";
import type { IconData, ShapeContentOp, ShapePathOp } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import type { CompileOutput } from "../src/compile";
import { iconShapeContents, parseTransform } from "../src/icon-shapes";
import { CONTEXT, spec } from "./fixtures";

/** Iconify'dagi haqiqiy Lucide ma'lumotlari (`@iconify-json/lucide`). */
const SQUARE: IconData = {
  body: '<rect width="18" height="18" x="3" y="3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" rx="2"/>',
  left: 0,
  top: 0,
  width: 24,
  height: 24,
};
const BELL: IconData = {
  body: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></g>',
  left: 0,
  top: 0,
  width: 24,
  height: 24,
};
/** To'ldirilgan, kvadrat bo'lmagan viewBox (mdi uslubi). */
const WIDE: IconData = {
  body: '<path fill="currentColor" d="M0 0h20v10H0z"/>',
  left: 0,
  top: 0,
  width: 20,
  height: 10,
};

function bounds(paths: ShapePathOp[]): [number, number, number, number] {
  const xs = paths.flatMap((p) => p.points.map((q) => q[0]));
  const ys = paths.flatMap((p) => p.points.map((q) => q[1]));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const groups = (contents: ShapeContentOp[] | null) => contents![0]!.contents!;

describe("iconShapeContents", () => {
  it("o'lcham aniq, markaz (0,0), chiziq qalinligi masshtab bilan", () => {
    const contents = iconShapeContents(SQUARE, 96, "#FF3B30", 2);
    expect(contents![0]).toMatchObject({ id: "icon", kind: "group" });
    const [p1] = groups(contents);
    // 24 birlik → 96 px (k = 4): rect 3…21 → −36…36.
    expect(bounds(p1!.paths!)).toEqual([-36, -36, 36, 36]);
    expect(p1!.stroke).toEqual({ color: "#FF3B30", width: 8, cap: "round", join: "round" });
    expect(p1!.fill).toBeUndefined();
  });

  it("spec qalinligi, meros (g) va SVG tartibi teskari (keyingi element ustida)", () => {
    const list = groups(iconShapeContents(BELL, 48, "#FFFFFF", 1.5));
    expect(list.map((g) => g.id)).toEqual(["p2", "p1"]);
    for (const g of list) {
      expect(g.stroke).toMatchObject({ color: "#FFFFFF", width: 3, cap: "round", join: "round" });
    }
  });

  it("kvadrat bo'lmagan viewBox nisbat saqlanib markazga; to'ldirilgan ikonka", () => {
    const [p1] = groups(iconShapeContents(WIDE, 100, "#00FF00", 2));
    expect(bounds(p1!.paths!)).toEqual([-50, -25, 50, 25]);
    expect(p1!.fill).toEqual({ color: "#00FF00", rule: "nonzero" });
    expect(p1!.stroke).toBeUndefined();
  });

  it("transform, circle, polyline, opacity", () => {
    const icon: IconData = {
      body: '<g transform="translate(12 12)" opacity="0.5"><circle r="4" fill="#123456"/><polyline points="-8,0 8,0" fill="none" stroke="#000" stroke-width="2"/></g>',
      left: 0,
      top: 0,
      width: 24,
      height: 24,
    };
    const [line, circle] = groups(iconShapeContents(icon, 24, "#FFFFFF", 2));
    expect(bounds(circle!.paths!)).toEqual([-4, -4, 4, 4]);
    expect(circle!.fill).toMatchObject({ color: "#123456", opacity: 50 });
    expect(bounds(line!.paths!)).toEqual([-8, 0, 8, 0]);
    expect(line!.stroke).toMatchObject({ width: 2, opacity: 50 });
  });

  it("gradient/mask/use — null (PDF yo'liga qaytadi)", () => {
    for (const body of [
      '<defs><linearGradient id="a"/></defs><path fill="url(#a)" d="M0 0h1v1z"/>',
      '<path mask="url(#m)" d="M0 0h1v1z"/>',
      '<use href="#a"/>',
    ]) {
      expect(
        iconShapeContents({ body, left: 0, top: 0, width: 24, height: 24 }, 96, "#FFFFFF", 2),
      ).toBeNull();
    }
  });

  it("parseTransform", () => {
    expect(parseTransform("translate(10 5) scale(2)")).toEqual([2, 0, 0, 2, 10, 5]);
    expect(parseTransform("bogus(1)")).toBeNull();
  });
});

function compiled(layers: object[], icons: Record<string, IconData> = {}): CompileOutput {
  const result = compile(
    spec({
      version: 1,
      format: { w: 1080, h: 1920, fps: 30 },
      output: { preset: "h264_social", name: "icons" },
      scenes: [{ id: "s1", dur: 3, layers }],
    }),
    { ...CONTEXT, icons },
  );
  if (!result.ok) throw new Error(result.error.message);
  for (const op of result.data.ops) {
    const parsed = parseOpEnvelope(op);
    expect(parsed.ok, `${op.op_id}: ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
  }
  return result.data;
}

describe("compile — icon qatlami", () => {
  it("as_shapes: native shape qatlam pos'da, trim keyframe'lari uchun Trim Paths", () => {
    const out = compiled(
      [
        {
          id: "bell",
          type: "icon",
          name: "lucide:bell",
          size: 120,
          pos: { x: 0.25, y: 0.25 },
          as_shapes: true,
          keyframes: {
            "contents.icon.trim.end": [
              { t: 0, v: 0 },
              { t: 0.8, v: 100 },
            ],
          },
        },
      ],
      { "lucide:bell": BELL },
    );
    const shape = out.ops.find((op) => op.op === "layer.add_shape")!;
    expect(shape.params).toMatchObject({ pos: [270, 480] });
    const root = (shape.params as { contents: ShapeContentOp[] }).contents[0]!;
    expect(root).toMatchObject({ id: "icon", trim: { start: 0, end: 100 } });
    expect(root.contents!.map((c) => c.stroke!.width)).toEqual([10, 10]);
    expect(out.ops.some((op) => op.op === "item.import")).toBe(false);
    expect(out.ops.find((op) => op.op === "prop.keyframes")!.params).toMatchObject({
      prop: "contents.icon.trim.end",
    });
  });

  it("oddiy: Iconify to'plami PDF footage (v2 fayl, to'plam nomi bilan), masshtab size/256", () => {
    const out = compiled([{ type: "icon", name: "mdi:bell", size: 128, color: "#FFCC00" }]);
    expect(out.ops.find((op) => op.op === "item.import")!.params).toMatchObject({
      file: "icons/mdi-bell_ffcc00_200_v2.pdf",
    });
    expect(out.ops.find((op) => op.op === "layer.add_media")!.params).toMatchObject({
      scale: 0.5,
      vector: true,
      pos: [540, 960],
    });
  });

  it("as_shapes, lekin geometriya murakkab: footage + ogohlantirish", () => {
    const out = compiled([{ type: "icon", name: "logos:x", as_shapes: true }], {
      "logos:x": {
        body: '<defs><linearGradient id="a"/></defs><path fill="url(#a)" d="M0 0h1v1z"/>',
        left: 0,
        top: 0,
        width: 24,
        height: 24,
      },
    });
    expect(out.ops.some((op) => op.op === "layer.add_media")).toBe(true);
    expect(out.warnings.join("\n")).toContain("as_shapes o'rniga vektor footage");
  });
});

describe("iconShapeContents — logolar (WorldVectorLogo uslubidagi SVG)", () => {
  const leaves = (contents: ShapeContentOp[] | null): ShapeContentOp[] => {
    const out: ShapeContentOp[] = [];
    const walk = (list: ShapeContentOp[]) =>
      list.forEach((c) => (c.contents === undefined ? out.push(c) : walk(c.contents)));
    walk(contents!);
    return out;
  };

  it("<style> klasslari, style atributi ustuvor, rgba va 8 xonali hex", () => {
    const icon: IconData = {
      body: '<style>.st0{fill:#2ebd59}.a,.b{fill:rgba(255,0,0,0.5)}</style><path class="st0" d="M0 0h10v10H0z"/><path class="b" d="M0 0h1v1z"/><path class="st0" style="fill:#00000080" d="M0 0h1v1z"/>',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      logo: true,
    };
    const list = leaves(iconShapeContents(icon, 100, "#FFFFFF", null)).reverse();
    expect(list.map((g) => g.fill)).toEqual([
      { color: "#2EBD59", rule: "nonzero" },
      { color: "#FF0000", rule: "nonzero", opacity: 50 },
      { color: "#000000", rule: "nonzero", opacity: 50.196 },
    ]);
  });

  it("defs/use (x, y bilan), sodipodi va metadata e'tiborsiz", () => {
    const icon: IconData = {
      body: '<metadata>x</metadata><sodipodi:namedview pagecolor="#fff"/><defs><rect id="r" width="4" height="4" fill="#123456"/></defs><use href="#r" x="6" y="6"/>',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    };
    const [r] = leaves(iconShapeContents(icon, 10, "#FFFFFF", 2));
    // 6…10 → markazlashganda 1…5.
    expect(bounds(r!.paths!)).toEqual([1, 1, 5, 5]);
    expect(r!.fill).toMatchObject({ color: "#123456" });
  });

  it("logo: asl stroke-width saqlanadi (spec qalinligi ta'sir qilmaydi)", () => {
    const icon: IconData = {
      body: '<path fill="none" stroke="#000" stroke-width="3" d="M0 5h10"/>',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      logo: true,
    };
    const [line] = leaves(iconShapeContents(icon, 100, "#FFFFFF", null));
    expect(line!.stroke!.width).toBe(30);
  });

  it("100+ element: bir xil bo'yoqlilar birlashadi, op chegaralari buzilmaydi", () => {
    const colors = ["#111111", "#222222", "#333333"];
    const body = Array.from(
      { length: 450 },
      (_, i) => `<path fill="${colors[Math.floor(i / 150)]}" d="M${i % 10} 0h1v1z"/>`,
    ).join("");
    const contents = iconShapeContents(
      { body, left: 0, top: 0, width: 10, height: 10 },
      100,
      "#FFFFFF",
      2,
    );
    const root = contents![0]!;
    expect(root.contents!.length).toBeLessThanOrEqual(100);
    const list = leaves(contents);
    expect(list.every((g) => g.paths!.length <= 200)).toBe(true);
    expect(list.reduce((n, g) => n + g.paths!.length, 0)).toBe(450);
    // Tartib saqlangan: AE'da birinchi (ustdagi) guruh — SVG'dagi oxirgi rang.
    expect(list[0]!.fill!.color).toBe("#333333");
    expect(list.at(-1)!.fill!.color).toBe("#111111");
  });

  it("clipPath, text — null", () => {
    for (const body of ['<g clip-path="url(#c)"><path d="M0 0h1v1z"/></g>', "<text>Hi</text>"]) {
      expect(
        iconShapeContents({ body, left: 0, top: 0, width: 24, height: 24 }, 96, "#FFFFFF", 2),
      ).toBeNull();
    }
  });
});
