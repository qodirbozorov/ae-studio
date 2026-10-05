import { parseOpEnvelope } from "@aes/shared";
import type { OpEnvelope } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { MAIN_COMP, compile } from "../src/compile";
import type { CompileOutput } from "../src/compile";
import { CONTEXT, THREE_SCENES, spec } from "./fixtures";

function compiled(input: unknown = THREE_SCENES, ctx = CONTEXT): CompileOutput {
  const result = compile(spec(input), ctx);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ids = (ops: OpEnvelope[]) => ops.map((o) => o.op_id);
const params = (out: CompileOutput, opId: string) => out.ops.find((o) => o.op_id === opId)?.params;

describe("compile — tuzilma", () => {
  it("barcha oplar sxemaga mos, op_id yagona, seq ketma-ket", () => {
    const out = compiled();
    for (const op of out.ops) {
      const parsed = parseOpEnvelope(op);
      expect(parsed.ok, `${op.op_id}: ${parsed.ok ? "" : parsed.error.message}`).toBe(true);
    }
    expect(new Set(ids(out.ops)).size).toBe(out.ops.length);
    expect(out.ops.map((o) => o.seq)).toEqual(out.ops.map((_, i) => i));
  });

  it("tartib: loyiha → importlar → asosiy comp → sahnalar → saqlash; havola qilingan op avval keladi", () => {
    const out = compiled();
    expect(out.ops[0]).toMatchObject({
      op: "project.open_or_create",
      params: { path: "reel_v001.aep" },
    });
    expect(out.ops.at(-1)).toMatchObject({
      op: "project.save",
      params: { version: 1, path: "reel_v001.aep" },
    });
    // Har sahnadan keyin oraliq saqlash (resume uchun).
    expect(ids(out.ops).filter((id) => id.endsWith(".save"))).toEqual([
      "hook.save",
      "point.save",
      "cta.save",
      "aes.save",
    ]);
    expect(ids(out.ops).slice(1, 4)).toEqual(["asset.clip_01", "asset.photo_02", "asset.ding"]);
    const position = new Map(out.ops.map((o, i) => [o.op_id, i]));
    for (const [i, op] of out.ops.entries()) {
      const p = op.params as unknown as Record<string, unknown>;
      for (const field of ["comp", "item", "layer", "child", "parent"]) {
        const ref = p[field];
        if (typeof ref !== "string") continue;
        expect(position.get(ref), `${op.op_id}.${field} → ${ref}`).toBeLessThan(i);
      }
    }
  });

  it("sahna vaqtlari, umumiy davomiylik va nest", () => {
    const out = compiled();
    expect(out.scenes).toEqual([
      { id: "hook", start: 0, duration: 3, comp: "hook.comp" },
      { id: "point", start: 3, duration: 4, comp: "point.comp" },
      { id: "cta", start: 7, duration: 2.5, comp: "cta.comp" },
    ]);
    expect(out.duration).toBe(9.5);
    expect(params(out, MAIN_COMP)).toMatchObject({
      w: 1080,
      h: 1920,
      fps: 30,
      dur: 9.5,
      name: "reel_v1",
    });
    expect(params(out, "point.nest")).toEqual({
      child: "point.comp",
      parent: MAIN_COMP,
      start: 3,
      dur: 4,
      name: "point",
    });
    expect(params(out, "point.comp")).toMatchObject({
      name: "02_point",
      bg: "#101820",
      folder: "Scenes",
    });
  });

  it("layerlar: piksel joylashuv, fit, uslub, shape o'lchami, audio", () => {
    const out = compiled();
    expect(params(out, "hook.l0")).toMatchObject({
      item: "asset.clip_01",
      fit: "cover",
      pos: [540, 960],
    });
    expect(params(out, "hook.title")).toMatchObject({
      text: "3 ta xato",
      pos: [540, 960],
      style: { size: 120, color: "#FFFFFF", justify: "center" },
    });
    expect(params(out, "point.l1")).toMatchObject({
      kind: "rect",
      size: [864, 153.6],
      pos: [540, 1497.6],
      radius: 24,
    });
    expect(params(out, "cta.l1")).toMatchObject({ item: "asset.ding", start: 0.2, volume: -6 });
    expect(params(out, "cta.l0")).toMatchObject({ style: { color: "#FFCC00", all_caps: true } });
  });

  it("animatsiyalar: Ken Burns fit masshtabidan; pop; typewriter expression; slide", () => {
    const out = compiled();
    const cover = Math.round((1920 / 1080) * 100 * 1000) / 1000;
    expect(params(out, "hook.l0.anim")).toMatchObject({
      prop: "scale",
      relative: true,
      keys: [
        { t: 0, v: [cover, cover] },
        {
          t: 3,
          v: [Math.round(cover * 1.12 * 1000) / 1000, Math.round(cover * 1.12 * 1000) / 1000],
        },
      ],
    });
    expect(params(out, "hook.title.anim")).toMatchObject({ prop: "scale", ease: "ease_out" });
    expect(params(out, "point.caption.anim")).toEqual({
      layer: "point.caption",
      prop: "ADBE Text Properties/ADBE Text Document",
      expr_id: "typewriter",
      args: { cps: 20 },
    });
    expect(params(out, "cta.l0.anim")).toMatchObject({ prop: "position" });
    expect(params(out, "cta.l0.anim.fade")).toMatchObject({ prop: "opacity" });
  });

  it("o'tishlar nest layer'ida absolyut vaqt bilan", () => {
    const out = compiled();
    expect(params(out, "hook.nest.transition")).toMatchObject({
      layer: "hook.nest",
      prop: "position",
      relative: false,
      keys: [
        { t: 2.7, v: [540, 960] },
        { t: 3, v: [-540, 960] },
      ],
    });
    expect(params(out, "point.nest.transition")).toMatchObject({
      prop: "opacity",
      keys: [{ t: 6.7 }, { t: 7 }],
    });
    expect(ids(out.ops).filter((id) => id.startsWith("cta.nest."))).toEqual([]);
  });

  it("VERIFY kalit vaqtlari har sahnani qamraydi", () => {
    const out = compiled();
    expect(out.keyTimes).toEqual([0.6, 1.5, 2.6, 3.6, 5, 6.6, 7.6, 8.25, 9.1]);
  });
});

describe("compile — determinizm va barqaror op_id", () => {
  it("bir xil kirish → bir xil chiqish (snapshot)", () => {
    const a = compiled();
    expect(compiled()).toEqual(a);
    expect(a.ops).toMatchSnapshot();
  });

  it("bitta sahnadagi o'zgarish boshqa sahnalarning op_id/params'iga ta'sir qilmaydi", () => {
    const before = compiled();
    const edited = clone(THREE_SCENES);
    edited.scenes[1]!.layers[2]!.text = "Yangi matn";
    const after = compiled(edited);
    expect(ids(after.ops)).toEqual(ids(before.ops));
    const changed = after.ops.filter(
      (op, i) => JSON.stringify(op) !== JSON.stringify(before.ops[i]),
    );
    expect(changed.map((o) => o.op_id)).toEqual(["point.caption"]);
  });
});

describe("compile — xatolar", () => {
  it("vo: davomiylik TTS'siz → SPEC_INVALID; sceneDurations bilan ishlaydi", () => {
    const input = {
      ...clone(THREE_SCENES),
      audio: { voiceover: { kind: "tts", voice_id: "v1", text: "Bir. Ikki." } },
    };
    input.scenes[0]!.dur = "vo:0-1" as unknown as number;
    const failed = compile(spec(input), CONTEXT);
    expect(failed.ok ? null : failed.error.code).toBe("SPEC_INVALID");
    const okResult = compile(spec(input), { ...CONTEXT, sceneDurations: { hook: 2.2 } });
    expect(okResult.ok && okResult.data.scenes[0]?.duration).toBe(2.2);
  });

  it("noma'lum, buzuq, yo'q asset va audio'ni media sifatida ishlatish", () => {
    const missingKey = { ...CONTEXT, assets: { ...CONTEXT.assets } };
    delete (missingKey.assets as Record<string, unknown>).photo_02;
    const code = (ctx = CONTEXT, input: unknown = THREE_SCENES) => {
      const r = compile(spec(input), ctx);
      return r.ok ? null : r.error.code;
    };
    expect(code(missingKey)).toBe("SPEC_UNKNOWN_ASSET");
    const status = (s: "corrupt" | "missing") => ({
      ...CONTEXT,
      assets: { ...CONTEXT.assets, clip_01: { ...CONTEXT.assets.clip_01!, status: s } },
    });
    expect(code(status("corrupt"))).toBe("ASSET_CORRUPT");
    expect(code(status("missing"))).toBe("ASSET_MISSING");
    const audioAsMedia = clone(THREE_SCENES);
    audioAsMedia.scenes[0]!.layers[0]!.src = "asset:ding";
    expect(code(CONTEXT, audioAsMedia)).toBe("SPEC_INVALID");
  });

  it("shablon sahnasi hozircha SPEC_UNKNOWN_TEMPLATE", () => {
    const input = clone(THREE_SCENES) as Record<string, unknown> & {
      scenes: Record<string, unknown>[];
    };
    input.scenes[2] = { id: "cta", dur: 2, template: "hook_title", slots: { title: "x" } };
    const r = compile(spec(input), CONTEXT);
    expect(r.ok ? null : r.error.code).toBe("SPEC_UNKNOWN_TEMPLATE");
  });

  it("video layer'dan qisqa bo'lsa ogohlantirish", () => {
    const short = {
      ...CONTEXT,
      assets: {
        ...CONTEXT.assets,
        clip_01: { ...CONTEXT.assets.clip_01!, meta: { width: 1920, height: 1080, duration: 1 } },
      },
    };
    const r = compile(spec(), short);
    expect(r.ok && r.data.warnings.some((w) => w.includes("hook.l0"))).toBe(true);
  });
});
