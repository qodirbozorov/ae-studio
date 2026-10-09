/**
 * P2.14 gate'ining kod qismi: qo'lda yozilgan 3 sahnali plan.json → compiler → ExtendScript (mock AE).
 * Qayta yuborish (resume) dublikat yaratmaydi.
 */
import { compile } from "@aes/compiler";
import type { CompileContext } from "@aes/compiler";
import { parseSpec } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { CONTEXT, THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { CompItem, createMockAE } from "./ae-mock";
import type { MockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";
import type { Harness } from "./jsx-harness";

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
      [`${ROOT}/source/photo_02.jpg`]: { width: 1000, height: 1500 },
      [`${ROOT}/audio/ding.wav`]: { hasVideo: false, hasAudio: true, duration: 1 },
    },
  });
}

function compiled(ctx: CompileContext = CONTEXT) {
  const spec = parseSpec(THREE_SCENES);
  if (!spec.ok) throw new Error(spec.error.message);
  const out = compile(spec.data, ctx);
  if (!out.ok) throw new Error(out.error.message);
  return out.data;
}

/** Oplarni bitta-bitta (bitta evalScript = bitta op) yuboradi. */
function runAll(h: Harness, ops: ReturnType<typeof compiled>["ops"]) {
  const results = [];
  for (const op of ops) {
    const res = h.run(op.op, op.op_id, op.params as never, { root: ROOT });
    if (!res.ok) throw new Error(`${op.op_id}: ${res.error.code} ${res.error.message ?? ""}`);
    results.push(res.data);
  }
  return results;
}

const byName = (h: Harness, name: string) =>
  h.ae.app.project.itemsList.find((i) => i.name === name) as CompItem;

describe("3 sahnali video: plan.json → compiler → AE", () => {
  it("to'liq quriladi: asosiy comp, sahnalar, layerlar, animatsiya, o'tishlar, saqlash", async () => {
    const out = compiled();
    const h = await loadJsx(ae());
    const results = runAll(h, out.ops);
    // Birinchi build'da hamma narsa yangidan yaratiladi (ochiq faylga oraliq saqlash bundan mustasno).
    const reused = results.filter((r) => r.reused).map((r) => r.op_id);
    expect(reused).toEqual(["hook.save", "point.save", "cta.save", "aes.save"]);

    const main = byName(h, "reel_v1");
    expect(main).toBeInstanceOf(CompItem);
    expect([main.width, main.height, main.duration]).toEqual([1080, 1920, 9.5]);
    // Sahnalar nest qilingan: oxirgi qo'shilgan tepada.
    expect(main.layersList.map((l) => [l.name, l.startTime, l.outPoint])).toEqual([
      ["cta", 7, 9.5],
      ["point", 3, 7],
      ["hook", 0, 3],
    ]);
    const hookNest = main.layersList[2]!;
    expect(hookNest.transform("ADBE Position").keys.map((k) => k.time)).toEqual([2.7, 3]);

    const point = byName(h, "02_point");
    // id'li layer AE'da id nomi bilan (P5.02: aep shablon slotlari shu nom bo'yicha).
    expect(point.layersList.map((l) => l.name)).toEqual([
      "caption",
      "Shape Layer 1",
      "photo_02.jpg",
      "BG",
    ]);
    const caption = point.layersList[0]!;
    expect(
      caption.property("ADBE Text Properties").property("ADBE Text Document").expression,
    ).toContain("sourceText");

    const cta = byName(h, "03_cta");
    const title = cta.layersList[1]!;
    expect(
      (
        title.property("ADBE Text Properties").property("ADBE Text Document").value as {
          text: string;
        }
      ).text,
    ).toBe("OBUNA BO'LING!");

    expect(h.ae.app.project.file?.fsName).toBe(`${ROOT}/reel_v001.aep`);
    expect(h.ae.app.project.dirty).toBe(false);
    expect(h.ae.app.openUndoGroups).toBe(0);
  });

  it("resume: AE'da shu loyiha ochiq bo'lsa barcha oplar qayta yuborilganda dublikat yo'q", async () => {
    const out = compiled();
    const h = await loadJsx(ae());
    runAll(h, out.ops);
    const items = h.ae.app.project.numItems;
    const layers = h.ae.app.project.itemsList
      .filter((i): i is CompItem => i instanceof CompItem)
      .map((c) => c.numLayers);

    const again = runAll(h, out.ops);
    const created = again.filter((r) => !r.reused).map((r) => r.op_id);
    // Faqat saqlash oplari qayta bajariladi (shu faylning o'ziga).
    expect(created).toEqual([]);
    expect(h.ae.app.project.numItems).toBe(items);
    expect(
      h.ae.app.project.itemsList
        .filter((i): i is CompItem => i instanceof CompItem)
        .map((c) => c.numLayers),
    ).toEqual(layers);
  });

  it("resume o'rtadan: ikkinchi sahnada to'xtagan build qolganini dublikatsiz quradi", async () => {
    const out = compiled();
    const h = await loadJsx(ae());
    const cut = out.ops.findIndex((o) => o.op_id === "point.l1");
    for (const op of out.ops.slice(0, cut))
      h.run(op.op, op.op_id, op.params as never, { root: ROOT });

    // Panel uzildi, server oxirgi `done` opdan emas — xavfsizlik uchun boshidan qayta yuboradi.
    const again = runAll(h, out.ops);
    const created = again.filter((r) => !r.reused).map((r) => r.op_id);
    expect(created[0]).toBe("point.l1");
    expect(created).not.toContain("hook.comp");
    expect(byName(h, "02_point").numLayers).toBe(4);
    expect(byName(h, "reel_v1").numLayers).toBe(3);
  });
});
