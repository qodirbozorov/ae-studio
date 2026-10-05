/** P2.09 yadro oplari mock AE'da (haqiqiy ES3 bundle). */
import { EXPRESSION_IDS } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { EXPRESSION_IDS as JSX_EXPRESSION_IDS } from "../src/jsx/lib/expressions";
import { KeyframeInterpolationType, createMockAE } from "./ae-mock";
import type { MockAE, CompItem } from "./ae-mock";
import { loadJsx } from "./jsx-harness";
import type { Harness } from "./jsx-harness";

const ROOT = "D:/Projects/reel";

function ae(): MockAE {
  return createMockAE({
    files: {
      [`${ROOT}/source/clip.mp4`]: {
        width: 1920,
        height: 1080,
        duration: 8,
        frameRate: 30,
        hasAudio: true,
      },
      [`${ROOT}/audio/vo.mp3`]: { hasVideo: false, hasAudio: true, duration: 6 },
      [`${ROOT}/fx/whip_left.ffx`]: {},
      [`${ROOT}/reel_v001.aep`]: {},
    },
  });
}

function comp(h: Harness, name: string): CompItem {
  return h.ae.app.project.itemsList.find((i) => i.name === name) as CompItem;
}

async function withMain(): Promise<Harness> {
  const h = await loadJsx(ae());
  h.run("comp.create", "main.comp", { name: "MAIN", w: 1080, h: 1920, fps: 30, dur: 10 });
  return h;
}

describe("project.open_or_create / project.save", () => {
  it("bo'sh AE: yangi loyiha yaratib yo'lga saqlaydi; qayta — reused", async () => {
    const h = await loadJsx(ae());
    const res = h.run("project.open_or_create", "proj", { path: "reel_v002.aep" });
    expect(res).toMatchObject({
      ok: true,
      data: { reused: false, target: { kind: "project", name: "reel_v002.aep" } },
    });
    expect(h.ae.app.opened).toEqual(["new"]);
    expect(h.ae.app.project.file?.fsName).toBe(`${ROOT}/reel_v002.aep`);
    expect(h.run("project.open_or_create", "proj", { path: "reel_v002.aep" })).toMatchObject({
      ok: true,
      data: { reused: true },
    });
    expect(h.ae.app.undoGroups).toEqual([]);
  });

  it("mavjud .aep ochiladi", async () => {
    const h = await loadJsx(ae());
    h.run("project.open_or_create", "proj", { path: "reel_v001.aep" });
    expect(h.ae.app.opened).toEqual([`open:${ROOT}/reel_v001.aep`]);
  });

  it("ochiq loyihada saqlanmagan o'zgarish bo'lsa boshqasi ochilmaydi (hech narsa yo'qolmaydi)", async () => {
    const h = await withMain();
    const res = h.run("project.open_or_create", "proj", { path: "reel_v001.aep" });
    expect(res).toMatchObject({ ok: false, error: { code: "AE_BAD_PARAMS" } });
    expect(h.ae.app.opened).toEqual([]);
  });

  it("project.save: yangi versiya saqlanadi; boshqa mavjud versiya ustiga yozilmaydi", async () => {
    const h = await withMain();
    expect(h.run("project.save", "save.2", { version: 2, path: "reel_v002.aep" })).toMatchObject({
      ok: true,
      data: { reused: false, info: { version: 2 } },
    });
    expect(h.ae.app.project.dirty).toBe(false);
    // Xuddi shu op qayta (resume) — shu faylning o'ziga saqlaydi.
    expect(h.run("project.save", "save.2", { version: 2, path: "reel_v002.aep" })).toMatchObject({
      ok: true,
      data: { reused: true },
    });
    expect(h.run("project.save", "save.1", { version: 1, path: "reel_v001.aep" })).toMatchObject({
      ok: false,
      error: { code: "AE_BAD_PARAMS" },
    });
  });
});

describe("comp.nest", () => {
  it("sahna comp'ini asosiy comp'ga nest qiladi; o'z-o'ziga mumkin emas", async () => {
    const h = await withMain();
    h.run("comp.create", "s1.comp", { name: "S1", w: 1080, h: 1920, fps: 30, dur: 3 });
    const res = h.run("comp.nest", "s1.nest", { child: "s1.comp", parent: "main.comp", start: 2 });
    expect(res).toMatchObject({ ok: true, data: { target: { kind: "layer", name: "S1" } } });
    const layer = comp(h, "MAIN").layer(1);
    expect(layer.source?.name).toBe("S1");
    expect([layer.startTime, layer.outPoint]).toEqual([2, 5]);
    expect(
      h.run("comp.nest", "s1.nest", { child: "s1.comp", parent: "main.comp", start: 2 }),
    ).toMatchObject({
      data: { reused: true },
    });
    expect(
      h.run("comp.nest", "bad", { child: "main.comp", parent: "main.comp", start: 0 }),
    ).toMatchObject({
      ok: false,
      error: { code: "AE_BAD_PARAMS" },
    });
  });
});

describe("layer.add_shape", () => {
  it("yumaloq to'rtburchak: o'lcham, radius, rang, joylashuv", async () => {
    const h = await withMain();
    const res = h.run("layer.add_shape", "s1.bar", {
      comp: "main.comp",
      kind: "rect",
      color: "#FFCC00",
      size: [864, 120],
      pos: [540, 1500],
      start: 0,
      radius: 24,
      opacity: 80,
    });
    expect(res.ok).toBe(true);
    const layer = comp(h, "MAIN").layer(1);
    const vectors = layer
      .property("ADBE Root Vectors Group")
      .property(1)
      .property("ADBE Vectors Group");
    expect(
      vectors.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").value,
    ).toEqual([864, 120]);
    expect(
      vectors.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Roundness").value,
    ).toBe(24);
    expect(
      vectors.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").value,
    ).toEqual([1, 0.8, 0]);
    expect(layer.transform("ADBE Position").value).toEqual([540, 1500]);
    expect(layer.transform("ADBE Opacity").value).toBe(80);
  });

  it("ellips", async () => {
    const h = await withMain();
    h.run("layer.add_shape", "dot", {
      comp: "main.comp",
      kind: "ellipse",
      color: "#000000",
      size: [50, 50],
      pos: [10, 10],
      start: 0,
    });
    const vectors = comp(h, "MAIN")
      .layer(1)
      .property("ADBE Root Vectors Group")
      .property(1)
      .property("ADBE Vectors Group");
    expect(
      vectors.property("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").value,
    ).toEqual([50, 50]);
  });
});

describe("layer.add_audio", () => {
  it("ovoz darajasi dB; video'li elementda tasvir o'chiriladi; ovozsiz element rad", async () => {
    const h = await withMain();
    h.run("item.import", "asset.vo", { file: "audio/vo.mp3" });
    h.run("item.import", "asset.clip", { file: "source/clip.mp4" });
    expect(
      h.run("layer.add_audio", "vo.layer", {
        comp: "main.comp",
        item: "asset.vo",
        start: 0.5,
        volume: -3,
      }).ok,
    ).toBe(true);
    const vo = comp(h, "MAIN").layer(1);
    expect(vo.property("ADBE Audio Group").property("ADBE Audio Levels").value).toEqual([-3, -3]);
    expect(vo.startTime).toBe(0.5);

    h.run("layer.add_audio", "clip.audio", {
      comp: "main.comp",
      item: "asset.clip",
      start: 0,
      volume: 0,
    });
    expect(comp(h, "MAIN").layer(1).enabled).toBe(false);

    h.run("comp.create", "s2.comp", { name: "S2", w: 100, h: 100, fps: 30, dur: 1 });
    expect(
      h.run("layer.add_audio", "x", { comp: "main.comp", item: "s2.comp", start: 0, volume: 0 }),
    ).toMatchObject({
      ok: false,
      error: { code: "AE_BAD_PARAMS" },
    });
  });
});

describe("prop.keyframes", () => {
  it("opacity fade-in: layer boshidan nisbiy vaqt, ease_out bezier; qayta yuborilsa takrorlanmaydi", async () => {
    const h = await withMain();
    h.run("layer.add_text", "s1.title", {
      comp: "main.comp",
      text: "Salom",
      start: 2,
      style: {},
      pos: [540, 960],
    });
    const layer = comp(h, "MAIN").layer(1);
    layer.inPoint = 2;
    const params = {
      layer: "s1.title",
      prop: "opacity",
      keys: [
        { t: 0, v: 0 },
        { t: 0.4, v: 100 },
      ],
      ease: "ease_out" as const,
      relative: true,
    };
    expect(h.run("prop.keyframes", "s1.title.fade", params)).toMatchObject({
      ok: true,
      data: { reused: false },
    });
    const opacity = layer.transform("ADBE Opacity");
    expect(opacity.keys.map((k) => [k.time, k.value])).toEqual([
      [2, 0],
      [2.4, 100],
    ]);
    expect(opacity.keys[0]?.outInterp).toBe(KeyframeInterpolationType.BEZIER);
    expect(opacity.keys[0]?.outEase?.[0]?.influence).toBe(75);
    expect(opacity.keys[0]?.inEase).toHaveLength(1);
    expect(h.run("prop.keyframes", "s1.title.fade", params)).toMatchObject({
      data: { reused: true },
    });
    expect(opacity.keys).toHaveLength(2);
  });

  it("scale: ease o'lchami 3 (ThreeD); position: 1 (spatial); hold; matchName yo'li", async () => {
    const h = await withMain();
    h.run("layer.add_shape", "box", {
      comp: "main.comp",
      kind: "rect",
      color: "#FFFFFF",
      size: [10, 10],
      pos: [0, 0],
      start: 0,
    });
    h.run("prop.keyframes", "box.pop", {
      layer: "box",
      prop: "scale",
      keys: [
        { t: 0, v: [0, 0, 100] },
        { t: 0.3, v: [100, 100, 100] },
      ],
      ease: "ease_in_out",
      relative: false,
    });
    h.run("prop.keyframes", "box.move", {
      layer: "box",
      prop: "ADBE Transform Group/ADBE Position",
      keys: [{ t: 1, v: [100, 200] }],
      ease: "hold",
      relative: false,
    });
    const layer = comp(h, "MAIN").layer(1);
    expect(layer.transform("ADBE Scale").keys[1]?.inEase).toHaveLength(3);
    expect(layer.transform("ADBE Position").keys[0]?.inInterp).toBe(KeyframeInterpolationType.HOLD);
  });

  it("noma'lum property → AE_NOT_FOUND; noma'lum layer → AE_NOT_FOUND", async () => {
    const h = await withMain();
    h.run("layer.add_text", "t", {
      comp: "main.comp",
      text: "x",
      start: 0,
      style: {},
      pos: [0, 0],
    });
    const base = { keys: [{ t: 0, v: 1 }], ease: "linear" as const, relative: true };
    expect(
      h.run("prop.keyframes", "k1", {
        ...base,
        layer: "t",
        prop: "ADBE Transform Group/ADBE Nope",
      }),
    ).toMatchObject({
      error: { code: "AE_NOT_FOUND" },
    });
    expect(
      h.run("prop.keyframes", "k2", { ...base, layer: "nope", prop: "opacity" }),
    ).toMatchObject({
      error: { code: "AE_NOT_FOUND" },
    });
  });
});

describe("prop.expression (faqat kutubxonadan)", () => {
  it("wiggle argumentlar bilan; kutubxonada yo'q id va kod kiritish rad etiladi", async () => {
    const h = await withMain();
    h.run("layer.add_text", "t", {
      comp: "main.comp",
      text: "x",
      start: 0,
      style: {},
      pos: [0, 0],
    });
    expect(
      h.run("prop.expression", "t.wiggle", {
        layer: "t",
        prop: "position",
        expr_id: "wiggle",
        args: { freq: 3, amp: 15 },
      }),
    ).toMatchObject({ ok: true });
    expect(comp(h, "MAIN").layer(1).transform("ADBE Position").expression).toBe("wiggle(3, 15)");

    expect(
      h.run("prop.expression", "e2", { layer: "t", prop: "position", expr_id: "eval_code" }),
    ).toMatchObject({
      error: { code: "AE_BAD_PARAMS" },
    });
    expect(
      h.run("prop.expression", "e3", {
        layer: "t",
        prop: "position",
        expr_id: "wiggle",
        args: { freq: "1); alert(1" },
      }),
    ).toMatchObject({ error: { code: "AE_BAD_PARAMS" } });
    expect(
      h.run("prop.expression", "e4", {
        layer: "t",
        prop: "position",
        expr_id: "loop_out",
        args: { type: 'x")' },
      }),
    ).toMatchObject({ error: { code: "AE_BAD_PARAMS" } });
  });

  it("kutubxona id'lari shared bilan bir xil", () => {
    expect([...JSX_EXPRESSION_IDS].sort()).toEqual([...EXPRESSION_IDS].sort());
  });
});

describe("fx.add / fx.apply_preset", () => {
  it("effekt va parametrlar (matchName va ko'rinadigan nom bilan); noma'lum effekt/parametr rad", async () => {
    const h = await withMain();
    h.run("layer.add_text", "t", {
      comp: "main.comp",
      text: "x",
      start: 0,
      style: {},
      pos: [0, 0],
    });
    expect(
      h.run("fx.add", "t.blur", {
        layer: "t",
        matchName: "ADBE Gaussian Blur 2",
        name: "Blur",
        params: { Blurriness: 20, "ADBE Gaussian Blur 2-0003": true },
      }),
    ).toMatchObject({ ok: true });
    const effect = comp(h, "MAIN").layer(1).property("ADBE Effect Parade").property(1);
    expect(effect.property("Blurriness").value).toBe(20);
    expect(effect.property("ADBE Gaussian Blur 2-0003").value).toBe(true);

    expect(h.run("fx.add", "t.nope", { layer: "t", matchName: "VC Optical Flares" })).toMatchObject(
      {
        error: { code: "AE_BAD_PARAMS" },
      },
    );
    expect(
      h.run("fx.add", "t.bad", { layer: "t", matchName: "ADBE Fill", params: { Nope: 1 } }),
    ).toMatchObject({ error: { code: "AE_BAD_PARAMS" } });
    // Idempotent: qayta yuborilsa ikkinchi effekt qo'shilmaydi.
    h.run("fx.add", "t.blur", { layer: "t", matchName: "ADBE Gaussian Blur 2" });
    expect(comp(h, "MAIN").layer(1).property("ADBE Effect Parade").numProperties).toBe(2);
  });

  it("ffx preset ish papkasidan; yo'q fayl ASSET_MISSING", async () => {
    const h = await withMain();
    h.run("layer.add_text", "t", {
      comp: "main.comp",
      text: "x",
      start: 0,
      style: {},
      pos: [0, 0],
    });
    expect(h.run("fx.apply_preset", "t.whip", { layer: "t", ffx: "fx/whip_left.ffx" }).ok).toBe(
      true,
    );
    expect(comp(h, "MAIN").layer(1).presets).toEqual([`${ROOT}/fx/whip_left.ffx`]);
    expect(h.run("fx.apply_preset", "t.none", { layer: "t", ffx: "fx/none.ffx" })).toMatchObject({
      error: { code: "ASSET_MISSING" },
    });
  });
});

describe("undo (Live ekrani: Undo last)", () => {
  it("faqat AE'dagi oxirgi undo group shu op bo'lsa bekor qiladi; undo group ochmaydi", async () => {
    const h = await loadJsx(ae());
    const run = (op: string, id: string, params: object) => {
      const res = h.run(op as never, id, params as never, { root: ROOT });
      if (!res.ok) throw new Error(`${id}: ${res.error.code}`);
      return res.data;
    };
    run("comp.create", "c1", { name: "A", w: 1080, h: 1920, fps: 30, dur: 5 });
    run("layer.add_text", "t1", {
      comp: "c1",
      text: "Salom",
      start: 0,
      style: {},
      pos: [540, 960],
    });

    const wrong = h.run("undo", "undo.c1", { op_id: "c1" }, { root: ROOT });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe("AE_NOT_FOUND");

    const res = h.run("undo", "undo.t1", { op_id: "t1" }, { root: ROOT });
    expect(res).toMatchObject({ ok: true, data: { info: { undone: "t1" } } });
    expect(h.ae.app.undone).toEqual(["aes:t1"]);
    expect(h.ae.app.undoGroups).toEqual(["aes:c1"]);
    expect(h.ae.app.openUndoGroups).toBe(0);
  });
});
