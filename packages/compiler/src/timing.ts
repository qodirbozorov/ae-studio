/**
 * TTS-first timing (§7.1, P4.10): voiceover so'z vaqtlari → gaplar → `dur: "vo:a-b"` sahnalari soniyada.
 * Gap chegarasi: `B[0] = 0`, `B[k]` = k-gapning boshlanishi (oldingi gapdan keyingi pauza oldingi sahnaga qo'shiladi),
 * `B[n]` = audio oxiri + kichik "dum". `vo:a-b` = `B[b] − B[a]`.
 */
import { fail, ok, parseSceneAnchor, parseVoRange } from "@aes/shared";
import type { Result, VideoSpec } from "@aes/shared";
import type { CaptionWord } from "@aes/shared";

/** Oxirgi gapdan keyin qo'shiladigan zaxira (so'nggi so'z kesilmasligi uchun). */
export const VO_TAIL_S = 0.3;

export interface AlignmentLike {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** TTS belgi vaqtlari → so'zlar (bo'shliq bo'yicha). */
export function wordsFromAlignment(alignment: AlignmentLike): CaptionWord[] {
  const words: CaptionWord[] = [];
  let text = "";
  let start = 0;
  let end = 0;
  alignment.characters.forEach((char, i) => {
    if (/\s/.test(char)) {
      if (text !== "") words.push({ text, start: round(start), end: round(end) });
      text = "";
      return;
    }
    if (text === "") start = alignment.character_start_times_seconds[i] ?? end;
    text += char;
    end = alignment.character_end_times_seconds[i] ?? end;
  });
  if (text !== "") words.push({ text, start: round(start), end: round(end) });
  return words;
}

/** So'zlar → gap chegaralari `B[0..n]`. */
export function sentenceBoundaries(words: CaptionWord[], audioDuration: number | null): number[] {
  const starts: number[] = [];
  let open = true;
  for (const word of words) {
    if (open) {
      starts.push(word.start);
      open = false;
    }
    if (/[.!?…]["»)]?$/.test(word.text)) open = true;
  }
  const last = words[words.length - 1]?.end ?? 0;
  const end = round(Math.max(audioDuration ?? 0, last) + VO_TAIL_S);
  if (starts.length === 0) return [0, end];
  return [0, ...starts.slice(1).map(round), end];
}

export interface TimedScene {
  id: string;
  start: number;
  duration: number;
}

export interface Timing {
  scenes: TimedScene[];
  total: number;
  /** Voiceover asosiy timeline'da qayerdan boshlanadi (vo sahnalardan oldin oddiy sahnalar bo'lsa > 0). */
  voOffset: number;
}

/**
 * Sahna davomiyliklari: son yoki `vo:a-b` (voiceover so'zlari bilan).
 * Voiceover yo'q bo'lsa `vo:` sahnalar uchun SPEC_INVALID.
 */
export function planTiming(
  spec: VideoSpec,
  voiceover: { words: CaptionWord[]; duration: number | null } | null,
  overrides: Record<string, number> = {},
): Result<Timing> {
  const boundaries =
    voiceover === null ? null : sentenceBoundaries(voiceover.words, voiceover.duration);
  const scenes: TimedScene[] = [];
  let cursor = 0;
  let voOffset: number | null = null;
  for (const [index, scene] of spec.scenes.entries()) {
    let duration: number;
    const override = overrides[scene.id];
    if (override !== undefined) duration = override;
    else if (typeof scene.dur === "number") duration = scene.dur;
    else {
      const range = parseVoRange(scene.dur);
      if (range === null) return fail("SPEC_INVALID", `/scenes/${index}/dur: noto'g'ri`);
      if (boundaries === null) {
        return fail(
          "SPEC_INVALID",
          `/scenes/${index}/dur: '${scene.dur}' voiceover vaqtlari hisoblangandan keyin aniqlanadi (TTS-first timing)`,
        );
      }
      const sentences = boundaries.length - 1;
      if (range.to > sentences) {
        return fail(
          "SPEC_INVALID",
          `/scenes/${index}/dur: '${scene.dur}' — voiceover'da faqat ${sentences} ta gap bor`,
          { sentences },
        );
      }
      if (voOffset === null) voOffset = round(cursor - boundaries[range.from]!);
      duration = boundaries[range.to]! - boundaries[range.from]!;
    }
    scenes.push({ id: scene.id, start: round(cursor), duration: round(duration) });
    cursor += duration;
  }
  return ok({ scenes, total: round(cursor), voOffset: voOffset ?? 0 });
}

/** `s1.end`, `s2.start+0.5` yoki son → asosiy timeline'dagi soniya. */
export function resolveAt(at: number | string, scenes: TimedScene[]): number | null {
  if (typeof at === "number") return at;
  const anchor = parseSceneAnchor(at);
  if (anchor === null) return null;
  const scene = scenes.find((s) => s.id === anchor.scene);
  if (scene === undefined) return null;
  const base = anchor.edge === "start" ? scene.start : scene.start + scene.duration;
  return round(Math.max(0, base + anchor.offset));
}

/** Ovoz eshitiladigan oraliqlar (ducking): yaqin so'zlar birlashtiriladi. */
export function voiceSegments(
  words: CaptionWord[],
  offset = 0,
  gap = 0.4,
): { start: number; end: number }[] {
  const segments: { start: number; end: number }[] = [];
  for (const word of words) {
    const start = round(word.start + offset);
    const end = round(word.end + offset);
    const last = segments[segments.length - 1];
    if (last !== undefined && start - last.end <= gap) last.end = Math.max(last.end, end);
    else segments.push({ start, end });
  }
  return segments;
}

export function shiftWords(words: CaptionWord[], offset: number): CaptionWord[] {
  return words.map((word) => ({
    text: word.text,
    start: round(word.start + offset),
    end: round(word.end + offset),
  }));
}
