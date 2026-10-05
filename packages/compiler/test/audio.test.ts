/**
 * P4.10–P4.11: TTS-first timing va audio oplar (voiceover, musiqa + ducking, SFX langarlari, subtitr, manba audio).
 */
import { parseSpec } from "@aes/shared";
import type { OpEnvelope, VideoSpec } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { compile } from "../src/compile";
import {
  planTiming,
  resolveAt,
  sentenceBoundaries,
  voiceSegments,
  wordsFromAlignment,
} from "../src/timing";
import { CONTEXT, THREE_SCENES } from "./fixtures";

function alignmentOf(text: string) {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (const char of text) {
    characters.push(char);
    starts.push(Math.round(t * 1000) / 1000);
    t += 0.1;
    ends.push(Math.round(t * 1000) / 1000);
    if (/[.!?]/.test(char)) t += 0.5;
  }
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

function spec(input: unknown): VideoSpec {
  const parsed = parseSpec(input);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.data;
}

const VO_TEXT = "Bir ikki. Uch to'rt! Besh.";

const VO_SPEC = {
  ...THREE_SCENES,
  scenes: [
    { ...THREE_SCENES.scenes[0], dur: "vo:0-1" },
    { ...THREE_SCENES.scenes[1], dur: "vo:1-3" },
    THREE_SCENES.scenes[2],
  ],
  audio: {
    voiceover: { kind: "tts", voice_id: "v1", text: VO_TEXT },
    music: {
      kind: "music",
      prompt: "upbeat",
      duck_under: "voiceover",
      duck_db: -10,
      volume_db: -4,
    },
    sfx: [{ id: "whoosh", prompt: "whoosh", duration_s: 0.8, at: "hook.end-0.2" }],
    captions: { from: "voiceover", style: "bold_pop", max_words: 3 },
  },
};

describe("so'z va gap vaqtlari", () => {
  it("alignment → so'zlar → gap chegaralari", () => {
    const words = wordsFromAlignment(alignmentOf(VO_TEXT));
    expect(words.map((w) => w.text)).toEqual(["Bir", "ikki.", "Uch", "to'rt!", "Besh."]);
    // Har belgi 0.1 s, gap oxiridan keyin 0.5 s pauza (bo'shliq ham belgi).
    expect(words[1]).toEqual({ text: "ikki.", start: 0.4, end: 0.9 });
    expect(words[2]!.start).toBe(1.5);
    // B[0]=0, 2-gap boshlanishi 1.5, 3-gap boshlanishi 3.1, oxiri (3.6) + 0.3
    const b = sentenceBoundaries(words, null);
    expect(b).toEqual([0, 1.5, 3.1, 3.9]);
  });

  it("planTiming: vo:a-b sahnalari, ortiqcha gap — xato, voOffset", () => {
    const words = wordsFromAlignment(alignmentOf(VO_TEXT));
    const timing = planTiming(spec(VO_SPEC), { words, duration: null });
    expect(timing).toMatchObject({
      ok: true,
      data: {
        scenes: [
          { id: "hook", start: 0, duration: 1.5 },
          { id: "point", start: 1.5, duration: 2.4 },
          { id: "cta", start: 3.9, duration: 2.5 },
        ],
        total: 6.4,
        voOffset: 0,
      },
    });
    const tooMany = spec({ ...VO_SPEC, scenes: [{ ...THREE_SCENES.scenes[0], dur: "vo:0-4" }] });
    expect(planTiming(tooMany, { words, duration: null })).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID", details: { sentences: 3 } },
    });
    expect(planTiming(spec(VO_SPEC), null)).toMatchObject({
      ok: false,
      error: { code: "SPEC_INVALID" },
    });

    const leading = spec({
      ...VO_SPEC,
      scenes: [
        { ...THREE_SCENES.scenes[2], id: "intro", dur: 2 },
        { ...THREE_SCENES.scenes[0], dur: "vo:0-3" },
      ],
    });
    const shifted = planTiming(leading, { words, duration: null });
    expect(shifted.ok && shifted.data.voOffset).toBe(2);
  });

  it("langarlar va ovoz oraliqlari", () => {
    const scenes = [
      { id: "a", start: 0, duration: 2 },
      { id: "b", start: 2, duration: 3 },
    ];
    expect(resolveAt("a.end", scenes)).toBe(2);
    expect(resolveAt("b.start+0.5", scenes)).toBe(2.5);
    expect(resolveAt("a.start-1", scenes)).toBe(0);
    expect(resolveAt(1.25, scenes)).toBe(1.25);
    expect(resolveAt("yoq.end", scenes)).toBeNull();
    expect(
      voiceSegments(
        [
          { text: "a", start: 0, end: 0.5 },
          { text: "b", start: 0.7, end: 1 },
          { text: "c", start: 2, end: 2.5 },
        ],
        1,
      ),
    ).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 3.5 },
    ]);
  });
});

describe("audio oplar (compile)", () => {
  const words = wordsFromAlignment(alignmentOf(VO_TEXT));
  const ctx = {
    ...CONTEXT,
    audio: {
      voiceover: { file: "audio/tts_aaa.mp3", words, duration: 3.3 },
      music: { file: "audio/music_bbb.mp3" },
      sfx: { whoosh: { file: "audio/sfx_ccc.mp3" } },
    },
  };
  const byId = (ops: OpEnvelope[], id: string) => ops.find((op) => op.op_id === id);

  it("voiceover, musiqa + ducking, SFX langari, subtitr — asosiy comp'da", () => {
    const out = compile(spec(VO_SPEC), ctx);
    if (!out.ok) throw new Error(out.error.message);
    const ops = out.data.ops;
    expect(out.data.duration).toBe(6.4);
    expect(byId(ops, "audio.vo")!.params).toEqual({ file: "audio/tts_aaa.mp3", folder: "Audio" });
    expect(byId(ops, "aes.vo")!.params).toMatchObject({
      comp: "aes.main",
      item: "audio.vo",
      start: 0,
      volume: 0,
    });
    expect(byId(ops, "aes.music")!.params).toMatchObject({
      item: "audio.music",
      start: 0,
      dur: 6.4,
      volume: -4,
    });
    expect(byId(ops, "aes.duck")!.params).toMatchObject({
      music_layer: "aes.music",
      voice_layer: "aes.vo",
      amount_db: -10,
      segments: [
        { start: 0, end: 0.9 },
        { start: 1.5, end: 2.5 },
        { start: 3.1, end: 3.6 },
      ],
    });
    expect(byId(ops, "aes.sfx.whoosh")!.params).toMatchObject({
      item: "audio.sfx.whoosh",
      start: 1.3,
    });
    const captions = byId(ops, "aes.captions")!.params as {
      words: unknown[];
      style: string;
      pos: number[];
      box_w: number;
    };
    expect(captions).toMatchObject({ style: "bold_pop", max_words: 3, box_w: 929 });
    expect(captions.words).toHaveLength(5);
    // Audio oplar oxirgi saqlashdan oldin.
    const ids = ops.map((op) => op.op_id);
    expect(ids.indexOf("aes.captions")).toBeLessThan(ids.indexOf("aes.save"));
    expect(out.data.warnings).toEqual([]);
  });

  it("fayllar yo'q bo'lsa ogohlantirish; manba audio: tozalanmagan bo'lsa media ovozi yoqiladi", () => {
    const noFiles = compile(spec(VO_SPEC), {
      ...CONTEXT,
      audio: { voiceover: { file: "audio/vo.mp3", words, duration: 3.3 } },
    });
    expect(noFiles.ok && noFiles.data.warnings).toEqual(
      expect.arrayContaining(["Musiqa fayli yo'q (AUDIO bajarilmagan)", "SFX whoosh fayli yo'q"]),
    );

    const interview = spec({
      ...THREE_SCENES,
      audio: {
        source_audio: { asset: "asset:clip_01", transcribe: true },
        captions: { from: "source_audio", method: "stt", style: "minimal" },
      },
    });
    const sourceWords = [{ text: "Salom", start: 0.2, end: 0.6 }];
    const raw = compile(interview, { ...CONTEXT, audio: { source: { words: sourceWords } } });
    if (!raw.ok) throw new Error(raw.error.message);
    expect(byId(raw.data.ops, "hook.l0")!.params).toMatchObject({ keep_audio: true });
    expect(byId(raw.data.ops, "aes.captions")!.params).toMatchObject({
      words: sourceWords,
      style: "minimal",
    });

    const cleanSpec = spec({
      ...THREE_SCENES,
      audio: { source_audio: { asset: "asset:clip_01", isolate: true } },
    });
    const clean = compile(cleanSpec, {
      ...CONTEXT,
      audio: { source: { isolatedFile: "audio/isolate_x.mp3" } },
    });
    if (!clean.ok) throw new Error(clean.error.message);
    expect(
      (byId(clean.data.ops, "hook.l0")!.params as { keep_audio?: boolean }).keep_audio,
    ).toBeUndefined();
    expect(byId(clean.data.ops, "aes.source")!.params).toMatchObject({
      item: "audio.source",
      start: 0,
    });
  });
});
