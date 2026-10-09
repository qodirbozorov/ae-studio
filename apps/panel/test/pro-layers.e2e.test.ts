/**
 * Faza 7: professional qatlamlar — spec → kompilyator → ExtendScript (mock AE). Shakllar (contents, SVG,
 * gradient, repeater), effektlar (alias, indeks, keyframe), mesh gradient, maska, matte, parent, 3D.
 */
import { compile, parseSvgPath } from "@aes/compiler";
import { parseSpec } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { CONTEXT } from "../../../packages/compiler/test/fixtures";
import { BlendingMode, KeyframeInterpolationType, MaskMode, createMockAE } from "./ae-mock";
import type { CompItem, Layer, Shape } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

const ROOT = "D:/Projects/reel";

const SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { name: "pro" },
  scenes: [
    {
      id: "s1",
      dur: 3,
      layers: [
        {
          type: "solid",
          id: "bg",
          color: "#101820",
          effects: [
            {
              id: "mesh",
              fx: "four_color_gradient",
              params: { color1: "#FF3366", point1: [100, 200] },
            },
            {
              id: "warp",
              fx: "turbulent_displace",
              params: { amount: 40 },
              keyframes: {
                evolution: [
                  { t: 0, v: 0 },
                  { t: 3, v: 360 },
                ],
              },
            },
          ],
        },
        {
          type: "shape",
          id: "ring",
          pos: { x: 0.5, y: 0.4 },
          contents: [
            {
              id: "track",
              kind: "ellipse",
              size: [400, 400],
              stroke: { color: "#E8E3D9", width: 30, cap: "round", dashes: [20, 10] },
            },
            {
              id: "arc",
              kind: "ellipse",
              size: [400, 400],
              stroke: { color: "#D97757", width: 30 },
              trim: { start: 0, end: 0 },
              keyframes: {
                "trim.end": [
                  { t: 0, v: 0 },
                  { t: 0.8, v: 75, ease: "enter" },
                ],
              },
            },
            {
              id: "icon",
              kind: "path",
              svg_d: "M4 12 L10 18 L20 6",
              fit: [120, 120],
              stroke: { color: "#FFFFFF", width: 12 },
            },
            {
              id: "badge",
              kind: "group",
              contents: [{ kind: "star", points: 5, outer_radius: 40, inner_radius: 18 }],
              fill: { color: "#FFD400" },
              repeater: { copies: 3, position: [90, 0] },
            },
          ],
          effects: [{ fx: "drop_shadow", params: { opacity: 50, distance: 12, color: "#000000" } }],
          keyframes: {
            scale: [
              { t: 0, v: 0 },
              { t: 0.5, v: 100, ease: "pop" },
            ],
            rotation: [
              { t: 0, v: -20 },
              { t: 1, v: 0, ease: [0.2, 0.8, 0.2, 1] },
            ],
          },
          parent: "ctrl",
        },
        {
          type: "shape",
          id: "grad",
          contents: [
            {
              kind: "rect",
              size: [600, 200],
              roundness: 40,
              fill: {
                gradient: { colors: ["#FF0000", "#0000FF"], start: [-300, 0], end: [300, 0] },
              },
            },
          ],
          masks: [{ id: "cut", ellipse: [-200, -100, 400, 200], feather: 10 }],
          matte: { source: "reveal" },
          blend: "screen",
        },
        { type: "solid", id: "reveal", color: "#FFFFFF", size: [600, 200] },
        {
          type: "null",
          id: "ctrl",
          three_d: true,
          transform: { position: [540, 960, 0] },
          keyframes: {
            rotation_y: [
              { t: 0, v: 0 },
              { t: 3, v: 30, ease: "soft" },
            ],
          },
        },
        {
          type: "adjustment",
          id: "fx",
          effects: [{ fx: "gaussian_blur", params: { blurriness: 4 } }],
        },
      ],
    },
  ],
};

function compiled() {
  const spec = parseSpec(SPEC);
  if (!spec.ok) throw new Error(JSON.stringify(spec.error.details));
  const out = compile(spec.data, CONTEXT);
  if (!out.ok) throw new Error(out.error.message);
  return out.data;
}

describe("professional qatlamlar (Faza 7)", () => {
  it("spec → kompilyator → AE: shakllar, effektlar, mesh, maska, matte, parent, 3D", async () => {
    const out = compiled();
    const ids = out.ops.map((op) => op.op_id);
    // parent/matte — sahnaning hamma layerlari yaratilgandan keyin.
    expect(ids.indexOf("s1.ring.link")).toBeGreaterThan(ids.indexOf("s1.ctrl"));
    expect(ids.indexOf("s1.grad.link")).toBeGreaterThan(ids.indexOf("s1.reveal"));

    const h = await loadJsx(createMockAE());
    for (const op of out.ops) {
      const res = h.run(op.op, op.op_id, op.params as never, { root: ROOT });
      if (!res.ok) throw new Error(`${op.op_id}: ${res.error.code} ${res.error.message ?? ""}`);
    }
    const scene = h.ae.app.project.itemsList.find((i) => i.name === "01_s1") as CompItem;
    const layer = (name: string): Layer => scene.layersList.find((l) => l.name === name)!;
    const vectors = (l: Layer, ...path: string[]) =>
      l
        .property("ADBE Root Vectors Group")
        .child(...path.flatMap((id) => [id, "ADBE Vectors Group"]));

    // Shakl: trim keyframe'lari segment ease bilan, stroke dash'lari, SVG yo'li, ichki guruh + repeater.
    const ring = layer("ring");
    const trimEnd = vectors(ring, "arc").child("ADBE Vector Filter - Trim", "ADBE Vector Trim End");
    expect(trimEnd.keys.map((k) => k.value)).toEqual([0, 75]);
    expect(trimEnd.keys[0]!.outInterp).toBe(KeyframeInterpolationType.BEZIER);
    const dashes = vectors(ring, "track").child(
      "ADBE Vector Graphic - Stroke",
      "ADBE Vector Stroke Dashes",
    );
    expect(dashes.children.map((c) => c.matchName)).toEqual([
      "ADBE Vector Stroke Dash 1",
      "ADBE Vector Stroke Gap 1",
    ]);
    const icon = vectors(ring, "icon").child("ADBE Vector Shape - Group", "ADBE Vector Shape")
      .value as Shape;
    expect(icon.vertices).toHaveLength(3);
    expect(Math.max(...icon.vertices.map((v) => Math.abs(v[0]!)))).toBeLessThanOrEqual(60);
    const badge = vectors(ring, "badge");
    expect(
      badge.child("c1", "ADBE Vectors Group", "ADBE Vector Shape - Star", "ADBE Vector Star Points")
        .value,
    ).toBe(5);
    expect(badge.child("ADBE Vector Filter - Repeater", "ADBE Vector Repeater Copies").value).toBe(
      3,
    );
    // Effekt: alias → indeks, foiz → 0–255.
    const shadow = ring.property("ADBE Effect Parade").child("fx1");
    expect(shadow.matchName).toBe("ADBE Drop Shadow");
    expect(shadow.child(2).value).toBe(127.5);
    // Qatlam keyframe'lari: scale son → [v, v]; parent.
    expect(ring.transform("ADBE Scale").keys.map((k) => k.value)).toEqual([
      [0, 0],
      [100, 100],
    ]);
    expect(ring.transform("ADBE Rotate Z").keys).toHaveLength(2);
    expect(ring.parent).toBe(layer("ctrl"));

    // Gradient: G-Fill (shape koordinatalari) + qatlam Tint'i; maska, matte, blend.
    const grad = layer("grad");
    const gfill = vectors(grad, "c1").child("ADBE Vector Graphic - G-Fill");
    expect(gfill.child("ADBE Vector Grad Start Pt").value).toEqual([-300, 0]);
    const tint = grad.property("ADBE Effect Parade").child("AES Gradient");
    expect(tint.child(1).value).toEqual([0, 0, 1]);
    expect(tint.child(2).value).toEqual([1, 0, 0]);
    const mask = grad.property("ADBE Mask Parade").child("cut");
    expect(mask.maskMode).toBe(MaskMode.ADD);
    expect(mask.child("ADBE Mask Feather").value).toEqual([10, 10]);
    expect((mask.child("ADBE Mask Shape").value as Shape).vertices).toHaveLength(4);
    expect(grad.trackMatteLayer).toBe(layer("reveal"));
    expect(layer("reveal").enabled).toBe(false);
    expect(grad.blendingMode).toBe(BlendingMode.SCREEN);

    // Mesh gradient + deformatsiya keyframe'lari (nom bo'yicha parametr), 3D null, adjustment.
    const bg = layer("bg").property("ADBE Effect Parade");
    expect(bg.child("mesh", "Color 1").value).toEqual([1, 0.2, 0.4, 1]);
    expect(bg.child("warp", "Evolution").keys).toHaveLength(2);
    expect(layer("ctrl").threeDLayer).toBe(true);
    expect(layer("ctrl").transform("ADBE Rotate Y").keys).toHaveLength(2);
    expect(layer("fx").adjustmentLayer).toBe(true);

    // Aniqlik vositalari: o'rnatilmagan effekt, katalog, comp tuzilmasi.
    expect(
      h.run("fx.add", "x.fx", { layer: "s1.ring", matchName: "S_Glow" }, { root: ROOT }),
    ).toMatchObject({ ok: false, error: { code: "FX_UNKNOWN" } });
    expect(h.run("fx.catalog", "c", { query: "warp" })).toMatchObject({
      ok: true,
      data: { info: { total: 1, effects: [{ match_name: "ADBE BEZMESH" }] } },
    });
    const inspected = h.run("layer.inspect", "i", { comp: "01_s1" });
    expect(inspected).toMatchObject({ ok: true });
    const types = (
      inspected.ok ? (inspected.data.info!.comp as { layers: { type: string }[] }).layers : []
    )
      .map((l) => l.type)
      .sort();
    expect(types).toEqual(["adjustment", "footage", "footage", "null", "shape", "shape"]);
  });

  it("spec tekshiruvi: contents/kind, parent havolasi, maska shakli, gradient aralashmasi", () => {
    const issues = (layers: unknown[]) => {
      const res = parseSpec({ ...SPEC, scenes: [{ id: "s1", dur: 1, layers }] });
      return res.ok ? [] : (res.error.details as { message: string }[]).map((d) => d.message);
    };
    expect(issues([{ type: "shape", pos: "center" }]).join()).toContain("contents");
    expect(issues([{ type: "solid", color: "#000000", parent: "nope" }]).join()).toContain("nope");
    expect(
      issues([
        { type: "solid", color: "#000000", masks: [{ rect: [0, 0, 1, 1], ellipse: [0, 0, 1, 1] }] },
      ]).join(),
    ).toContain("aynan bittasi");
    const mixed = parseSpec({
      ...SPEC,
      scenes: [
        {
          id: "s1",
          dur: 1,
          layers: [
            {
              type: "shape",
              contents: [
                {
                  kind: "rect",
                  size: [10, 10],
                  fill: {
                    gradient: { colors: ["#000000", "#FFFFFF"], start: [0, 0], end: [1, 0] },
                  },
                },
                { kind: "ellipse", size: [10, 10], fill: { color: "#FF0000" } },
              ],
            },
          ],
        },
      ],
    });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    const out = compile(mixed.data, CONTEXT);
    expect(out).toMatchObject({ ok: false, error: { code: "SPEC_INVALID" } });
  });

  it("SVG path: buyruqlar, nisbiy, arc, bir nechta yo'l, fit", () => {
    expect(parseSvgPath("M0 0 L10 0 L10 10 Z")).toEqual([
      {
        points: [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        in: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        out: [
          [0, 0],
          [0, 0],
          [0, 0],
        ],
        closed: true,
      },
    ]);
    const arc = parseSvgPath("M0 0 A10 10 0 0 1 20 0")[0]!;
    expect(arc.points).toHaveLength(3);
    expect(arc.points[2]).toEqual([20, 0]);
    const two = parseSvgPath("m10 10 h5 v5 z m20 0 l1 1");
    expect(two).toHaveLength(2);
    expect(two[1]!.points[0]).toEqual([30, 10]);
    expect(two[1]!.closed).toBe(false);
    expect(parseSvgPath("M0 0a5 5 0 015 5")[0]!.points.at(-1)).toEqual([5, 5]);
    expect(() => parseSvgPath("L0 0")).toThrow();
  });
});
