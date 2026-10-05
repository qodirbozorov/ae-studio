/** P5.01: `template.instantiate` mock AE'da (haqiqiy ES3 bundle). */
import { describe, expect, it } from "vitest";
import { createMockAE } from "./ae-mock";
import type { CompItem, FolderItem, MockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";
import type { Harness } from "./jsx-harness";

const ROOT = "D:/Projects/reel";

function ae(): MockAE {
  return createMockAE({
    files: {
      [`${ROOT}/source/photo.jpg`]: { width: 2000, height: 1000, duration: 0, frameRate: 0 },
      [`${ROOT}/templates/promo_v3.aep`]: {
        template: [
          {
            name: "PROMO",
            w: 1080,
            h: 1920,
            duration: 4,
            fps: 30,
            layers: [
              { name: "TITLE", kind: "text", text: "Sarlavha" },
              { name: "BG_PLACEHOLDER", kind: "solid", colorControls: ["Accent Color"] },
            ],
          },
          { name: "PROMO_inner", w: 100, h: 100, duration: 4, fps: 30, layers: [] },
        ],
      },
    },
  });
}

const PARAMS = {
  template: "promo",
  version: 3,
  file: "templates/promo_v3.aep",
  template_comp: "PROMO",
  slots: [
    { type: "text" as const, layer: "TITLE", text: "Chegirma!" },
    { type: "media" as const, layer: "BG_PLACEHOLDER", item: "asset.photo", fit: "cover" as const },
    { type: "color" as const, egp: "Accent Color", color: "#FF0000" },
  ],
  comp: "s1.comp",
  start: 0,
  dur: 6,
  stretch: "time_remap" as const,
  name: "promo",
};

async function setup(): Promise<Harness> {
  const h = await loadJsx(ae());
  h.run("comp.create", "s1.comp", { name: "01_s1", w: 1080, h: 1920, fps: 30, dur: 6 });
  h.run("comp.create", "s2.comp", { name: "02_s2", w: 1080, h: 1920, fps: 30, dur: 3 });
  h.run("item.import", "asset.photo", { file: "source/photo.jpg" });
  return h;
}

const named = (h: Harness, name: string) =>
  h.ae.app.project.itemsList.filter((i) => i.name === name);

describe("template.instantiate", () => {
  it("import → nusxa → slotlar → sahnaga time remap bilan; qayta — reused", async () => {
    const h = await setup();
    const res = h.run("template.instantiate", "s1.tpl", PARAMS);
    expect(res).toMatchObject({ ok: true, data: { reused: false, target: { name: "promo" } } });

    const folder = named(h, "promo_v3.aep")[0] as FolderItem;
    expect(folder.parentFolder?.name).toBe("Templates");
    const original = named(h, "PROMO")[0] as CompItem;
    const copy = named(h, "promo")[0] as CompItem;
    expect(copy).toBeDefined();
    expect(copy).not.toBe(original);

    // Matn nusxada o'zgargan, asl shablonda — yo'q.
    const textOf = (comp: CompItem) =>
      (
        comp.layersList
          .find((l) => l.name === "TITLE")!
          .property("ADBE Text Properties")
          .property("ADBE Text Document").value as { text: string }
      ).text;
    expect(textOf(copy)).toBe("Chegirma!");
    expect(textOf(original)).toBe("Sarlavha");

    // Media: placeholder manbasi almashgan, cover masshtab.
    const bg = copy.layersList.find((l) => l.name === "BG_PLACEHOLDER")!;
    expect(bg.source?.name).toBe("photo.jpg");
    expect(bg.transform("ADBE Scale").value).toEqual([192, 192]);

    // Rang: Color Control effekti (mock'da Essential Graphics yo'q).
    const color = bg.property("ADBE Effect Parade").property("Accent Color").property(1);
    expect(color.value).toEqual([1, 0, 0]);

    // Sahna comp'ida: time remap 4 s → 6 s.
    const scene = named(h, "01_s1")[0] as CompItem;
    const layer = scene.layersList[0]!;
    expect(layer.name).toBe("promo");
    expect(layer.timeRemapEnabled).toBe(true);
    const remap = layer.property("ADBE Time Remapping");
    expect(remap.keys.map((k) => [k.time, Number((k.value as number).toFixed(3))])).toEqual([
      [0, 0],
      [6 - 1 / 30, Number((4 - 1 / 30).toFixed(3))],
    ]);
    expect(layer.outPoint).toBeCloseTo(6);

    expect(h.run("template.instantiate", "s1.tpl", PARAMS)).toMatchObject({
      ok: true,
      data: { reused: true },
    });
  });

  it("ikkinchi sahna: shablon qayta import qilinmaydi, alohida nusxa; stretch none", async () => {
    const h = await setup();
    h.run("template.instantiate", "s1.tpl", PARAMS);
    const res = h.run("template.instantiate", "s2.tpl", {
      ...PARAMS,
      comp: "s2.comp",
      dur: 3,
      stretch: "none",
      slots: [{ type: "text", layer: "TITLE", text: "Ikkinchi" }],
    });
    expect(res.ok).toBe(true);
    expect(named(h, "promo_v3.aep")).toHaveLength(1);
    expect(named(h, "promo")).toHaveLength(2);
    const layer = (named(h, "02_s2")[0] as CompItem).layersList[0]!;
    expect(layer.timeRemapEnabled).toBe(false);
    expect(layer.outPoint).toBeCloseTo(3);
  });

  it("xatolar: fayl yo'q, comp yo'q, layer yo'q, rang xususiyati yo'q", async () => {
    const h = await setup();
    expect(
      h.run("template.instantiate", "x1", { ...PARAMS, file: "templates/yoq.aep", version: 9 }),
    ).toMatchObject({ ok: false, error: { code: "ASSET_MISSING" } });
    expect(h.run("template.instantiate", "x2", { ...PARAMS, template_comp: "NOPE" })).toMatchObject(
      { ok: false, error: { code: "AE_NOT_FOUND" } },
    );
    expect(
      h.run("template.instantiate", "x3", {
        ...PARAMS,
        slots: [{ type: "text", layer: "SUBTITLE", text: "x" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "AE_NOT_FOUND" } });
    expect(
      h.run("template.instantiate", "x4", {
        ...PARAMS,
        slots: [{ type: "color", egp: "Main Color", color: "#00FF00" }],
      }),
    ).toMatchObject({ ok: false, error: { code: "AE_NOT_FOUND" } });
  });
});
