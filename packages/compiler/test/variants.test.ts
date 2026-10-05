/** P5.05: bitta Spec'dan 9:16 / 1:1 / 16:9 — alohida asosiy comp'lar, nisbiy joylashuv, safe area, audio. */
import { parseOpEnvelope } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { MAIN_COMP, compile, variantFrames } from "../src/compile";
import type { CompileOutput } from "../src/compile";
import { CONTEXT, THREE_SCENES, spec } from "./fixtures";

function run(input: unknown, ctx = CONTEXT): CompileOutput {
  const out = compile(spec(input), ctx);
  if (!out.ok) throw new Error(out.error.message);
  for (const op of out.data.ops) {
    const parsed = parseOpEnvelope(op);
    if (!parsed.ok) throw new Error(`${op.op_id}: ${parsed.error.message}`);
  }
  return out.data;
}

const params = (out: CompileOutput, id: string) =>
  out.ops.find((o) => o.op_id === id)?.params as Record<string, unknown> | undefined;

describe("format variantlari", () => {
  it("variant kadrlari: qisqa tomon saqlanadi, asosiy aspekt takrorlanmaydi", () => {
    expect(
      variantFrames(spec({ ...THREE_SCENES, variants: ["9:16", "1:1", "16:9"] })).map((v) => [
        v.tag,
        v.frame,
      ]),
    ).toEqual([
      ["1x1", { w: 1080, h: 1080 }],
      ["16x9", { w: 1920, h: 1080 }],
    ]);
    expect(
      variantFrames(
        spec({ ...THREE_SCENES, format: { w: 1280, h: 720, fps: 30 }, variants: ["9:16"] }),
      )[0]!.frame,
    ).toEqual({ w: 720, h: 1280 });
  });

  it("variantsiz chiqish o'zgarmaydi; variantlar alohida asosiy comp va sahnalar bilan", () => {
    const base = run(THREE_SCENES);
    expect(base.variants).toEqual([]);
    const out = run({ ...THREE_SCENES, variants: ["1:1", "16:9"] });
    // Asosiy format oplari aynan avvalgidek (op_id va parametrlar).
    for (const op of base.ops.filter((o) => o.op_id !== "aes.save")) {
      expect(params(out, op.op_id), op.op_id).toEqual(op.params);
    }
    expect(out.variants).toEqual([
      {
        aspect: "1:1",
        tag: "1x1",
        mainComp: `${MAIN_COMP}.1x1`,
        name: "reel_v1_1x1",
        w: 1080,
        h: 1080,
      },
      {
        aspect: "16:9",
        tag: "16x9",
        mainComp: `${MAIN_COMP}.16x9`,
        name: "reel_v1_16x9",
        w: 1920,
        h: 1080,
      },
    ]);
    expect(params(out, `${MAIN_COMP}.16x9`)).toMatchObject({ w: 1920, h: 1080, dur: 9.5 });
    expect(params(out, "16x9.hook.comp")).toMatchObject({
      name: "16x9_01_hook",
      w: 1920,
      h: 1080,
      folder: "Scenes 16x9",
    });
    expect(params(out, "16x9.hook.nest")).toMatchObject({
      child: "16x9.hook.comp",
      parent: `${MAIN_COMP}.16x9`,
      start: 0,
    });
    // Importlar bitta (variantlar umumiy footage ishlatadi).
    expect(out.ops.filter((o) => o.op === "item.import").map((o) => o.op_id)).toEqual(
      base.ops.filter((o) => o.op === "item.import").map((o) => o.op_id),
    );
    // Nisbiy joylashuv: lower_third shape eni va pozitsiyasi kadrga moslashgan.
    const shape = params(out, "16x9.point.l1")!;
    expect(shape).toMatchObject({ size: [1536, 86.4], pos: [960, 842.4] });
    // Media fit kadrga qarab: 16:9 da cover masshtab boshqacha.
    expect(params(out, "16x9.hook.l0")).toMatchObject({ fit: "cover", pos: [960, 540] });
    expect(out.ops.at(-1)!.op_id).toBe("aes.save");
  });

  it("safe area: chetga yaqin matn kadr ichiga suriladi", () => {
    const out = run({
      ...THREE_SCENES,
      scenes: [
        {
          id: "s1",
          dur: 2,
          layers: [{ id: "t", type: "text", text: "Uzunroq sarlavha", pos: { x: 0.98, y: 0.99 } }],
        },
      ],
      variants: ["16:9"],
    });
    const pos = params(out, "s1.t")!.pos as [number, number];
    const width = "Uzunroq sarlavha".length * Math.round(1920 * 0.045) * 0.55;
    expect(pos[0] + width / 2).toBeLessThanOrEqual(1080 * 0.96 + 0.01);
    expect(pos[1]).toBeLessThanOrEqual(1920 * 0.96 + 0.01);
    const wide = params(out, "16x9.s1.t")!.pos as [number, number];
    expect(wide[1]).toBeLessThanOrEqual(1080 * 0.96 + 0.01);
  });

  it("audio har variant asosiy comp'ida; fayl importi bitta", () => {
    const words = [
      { text: "Salom", start: 0, end: 0.5 },
      { text: "dunyo.", start: 0.6, end: 1.1 },
    ];
    const out = run(
      {
        ...THREE_SCENES,
        variants: ["16:9"],
        audio: {
          voiceover: { kind: "tts", voice_id: "v", text: "Salom dunyo." },
          music: { kind: "music", prompt: "calm", duck_under: "voiceover" },
          captions: { from: "voiceover" },
        },
      },
      {
        ...CONTEXT,
        audio: {
          voiceover: { file: "audio/vo.mp3", words, duration: 1.5 },
          music: { file: "audio/music.mp3" },
        },
      },
    );
    expect(out.ops.filter((o) => o.op_id === "audio.vo")).toHaveLength(1);
    expect(params(out, "16x9.aes.vo")).toMatchObject({
      comp: `${MAIN_COMP}.16x9`,
      item: "audio.vo",
    });
    expect(params(out, "16x9.aes.duck")).toMatchObject({
      music_layer: "16x9.aes.music",
      voice_layer: "16x9.aes.vo",
    });
    expect(params(out, "16x9.aes.captions")).toMatchObject({
      comp: `${MAIN_COMP}.16x9`,
      box_w: Math.round(1920 * 0.86),
    });
  });
});
