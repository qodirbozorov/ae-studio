import { describe, expect, it } from "vitest";
import { CompItem, FootageItem, createMockAE } from "./ae-mock";
import type { MockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

const ROOT = "D:/Projects/reel";

function ae(): MockAE {
  return createMockAE({
    files: {
      [`${ROOT}/source/clip_01.mp4`]: {
        width: 1920,
        height: 1080,
        duration: 8,
        frameRate: 30,
        hasAudio: true,
      },
      [`${ROOT}/source/photo.jpg`]: { width: 1000, height: 1500, duration: 0 },
      [`${ROOT}/audio/vo.mp3`]: { hasVideo: false, hasAudio: true, duration: 12 },
    },
  });
}

const comp = {
  name: "MAIN",
  w: 1080,
  h: 1920,
  fps: 30,
  dur: 10,
  bg: "#FF0000",
  folder: "AE Studio",
};

describe("comp.create", () => {
  it("comp yaratadi, fon rangi, papka va op_id izi bilan", async () => {
    const h = await loadJsx(ae());
    const res = h.run("comp.create", "main.comp", comp);
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data).toMatchObject({ reused: false, target: { kind: "comp", name: "MAIN" } });
    const created = h.ae.app.project.itemsList.find((i) => i instanceof CompItem) as CompItem;
    expect(created.bgColor).toEqual([1, 0, 0]);
    expect(created.comment).toBe("[aes:main.comp]");
    expect(created.parentFolder?.name).toBe("AE Studio");
    expect(h.ae.app.undoGroups).toEqual(["aes:main.comp"]);
    expect(h.ae.app.openUndoGroups).toBe(0);
  });

  it("idempotent: qayta yuborilsa dublikat yo'q (resume, §2.5)", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    const before = h.ae.app.project.numItems;
    const again = h.run("comp.create", "main.comp", comp);
    expect(again).toMatchObject({ ok: true, data: { reused: true } });
    expect(h.ae.app.project.numItems).toBe(before);
  });

  it("kutilmagan ExtendScript istisnosi → AE_SCRIPT_ERROR, undo group yopiladi", async () => {
    const mock = ae();
    mock.app.project.items.addComp = () => {
      throw new Error("Disk to'la");
    };
    const h = await loadJsx(mock);
    const res = h.run("comp.create", "main.comp", comp);
    expect(res).toMatchObject({ ok: false, error: { code: "AE_SCRIPT_ERROR" } });
    if (!res.ok) expect(res.error.message).toContain("Disk to'la");
    expect(mock.app.openUndoGroups).toBe(0);
    expect(mock.app.suppressDialogs).toBe(0);
  });
});

describe("item.import", () => {
  it("faylni import qiladi va izini qo'yadi; qayta import qilinmaydi", async () => {
    const h = await loadJsx(ae());
    const res = h.run("item.import", "asset.clip_01", {
      file: "source/clip_01.mp4",
      folder: "Source",
    });
    expect(res).toMatchObject({
      ok: true,
      data: { reused: false, target: { kind: "footage", name: "clip_01.mp4" } },
    });
    expect(h.run("item.import", "asset.clip_01", { file: "source/clip_01.mp4" })).toMatchObject({
      ok: true,
      data: { reused: true },
    });
    expect(h.ae.app.project.itemsList.filter((i) => i instanceof FootageItem)).toHaveLength(1);
  });

  it("fayl yo'q → ASSET_MISSING; ish papkasidan tashqari → ASSET_OUTSIDE_ROOT (ikkinchi qatlam)", async () => {
    const h = await loadJsx(ae());
    expect(h.run("item.import", "a1", { file: "source/none.mp4" })).toMatchObject({
      ok: false,
      error: { code: "ASSET_MISSING" },
    });
    expect(h.run("item.import", "a2", { file: "../secret.mp4" })).toMatchObject({
      ok: false,
      error: { code: "ASSET_OUTSIDE_ROOT" },
    });
    expect(h.run("item.import", "a3", { file: "C:/Windows/x.mp4" })).toMatchObject({
      ok: false,
      error: { code: "ASSET_OUTSIDE_ROOT" },
    });
  });

  it("AE import qila olmasa → ASSET_UNSUPPORTED", async () => {
    const mock = ae();
    mock.app.project.importFile = () => {
      throw new Error("unsupported format");
    };
    const h = await loadJsx(mock);
    expect(h.run("item.import", "a1", { file: "source/clip_01.mp4" })).toMatchObject({
      ok: false,
      error: { code: "ASSET_UNSUPPORTED" },
    });
  });
});

describe("layer.add_text", () => {
  it("matn, uslub, joylashuv, vaqt va iz", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    const res = h.run("layer.add_text", "s1.title", {
      comp: "main.comp",
      text: "3 ta xato",
      start: 1,
      dur: 3,
      name: "TITLE",
      style: {
        font: "Montserrat-Bold",
        size: 96,
        color: "#FFFFFF",
        justify: "center",
        all_caps: true,
      },
      pos: [540, 800],
    });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data.target).toMatchObject({ kind: "layer", index: 1, name: "TITLE" });

    const main = h.ae.app.project.itemsList.find((i) => i.name === "MAIN") as CompItem;
    const layer = main.layer(1);
    const doc = layer.property("ADBE Text Properties").property("ADBE Text Document")
      .value as Record<string, unknown>;
    expect(doc).toMatchObject({
      text: "3 TA XATO",
      font: "Montserrat-Bold",
      fontSize: 96,
      fillColor: [1, 1, 1],
      justification: 7415,
    });
    expect(layer.transform("ADBE Position").value).toEqual([540, 800]);
    expect(layer.startTime).toBe(1);
    expect(layer.outPoint).toBe(4);
    expect(layer.comment).toBe("[aes:s1.title]");
  });

  it("idempotent va comp yo'q bo'lsa AE_NOT_FOUND", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    const params = {
      comp: "main.comp",
      text: "Salom",
      start: 0,
      style: {},
      pos: [1, 2] as [number, number],
    };
    h.run("layer.add_text", "t1", params);
    expect(h.run("layer.add_text", "t1", params)).toMatchObject({
      ok: true,
      data: { reused: true },
    });
    expect((h.ae.app.project.itemsList.find((i) => i.name === "MAIN") as CompItem).numLayers).toBe(
      1,
    );
    expect(h.run("layer.add_text", "t2", { ...params, comp: "no.comp" })).toMatchObject({
      ok: false,
      error: { code: "AE_NOT_FOUND" },
    });
    expect(h.ae.app.openUndoGroups).toBe(0);
  });
});

describe("layer.add_media", () => {
  it("fit cover: 16:9 video 9:16 comp'ni to'ldiradi, video ovozi o'chiriladi", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    h.run("item.import", "asset.clip_01", { file: "source/clip_01.mp4" });
    const res = h.run("layer.add_media", "s1.bg", {
      comp: "main.comp",
      item: "asset.clip_01",
      start: 0,
      dur: 5,
      fit: "cover",
    });
    if (!res.ok) throw new Error(res.error.message);
    const layer = (h.ae.app.project.itemsList.find((i) => i.name === "MAIN") as CompItem).layer(1);
    const scale = layer.transform("ADBE Scale").value as number[];
    expect(scale[0]).toBeCloseTo((1920 / 1080) * 100, 5);
    expect(scale[1]).toBeCloseTo((1920 / 1080) * 100, 5);
    expect(layer.transform("ADBE Position").value).toEqual([540, 960]);
    expect(layer.audioEnabled).toBe(false);
    expect(layer.outPoint).toBe(5);
  });

  it("fit contain va stretch", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    h.run("item.import", "asset.photo", { file: "source/photo.jpg" });
    const scaleOf = (opId: string, fit: "contain" | "stretch") => {
      h.run("layer.add_media", opId, { comp: "main.comp", item: "asset.photo", start: 0, fit });
      const main = h.ae.app.project.itemsList.find((i) => i.name === "MAIN") as CompItem;
      return main.layer(1).transform("ADBE Scale").value as number[];
    };
    expect(scaleOf("m1", "contain")).toEqual([108, 108]);
    expect(scaleOf("m2", "stretch")).toEqual([108, 128]);
  });

  it("faqat audio element → AE_BAD_PARAMS; noma'lum element → AE_NOT_FOUND", async () => {
    const h = await loadJsx(ae());
    h.run("comp.create", "main.comp", comp);
    h.run("item.import", "asset.vo", { file: "audio/vo.mp3" });
    expect(
      h.run("layer.add_media", "m1", {
        comp: "main.comp",
        item: "asset.vo",
        start: 0,
        fit: "cover",
      }),
    ).toMatchObject({ ok: false, error: { code: "AE_BAD_PARAMS" } });
    expect(
      h.run("layer.add_media", "m2", {
        comp: "main.comp",
        item: "asset.none",
        start: 0,
        fit: "cover",
      }),
    ).toMatchObject({ ok: false, error: { code: "AE_NOT_FOUND" } });
  });
});
