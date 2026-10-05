/**
 * Spec `audio` → ElevenLabs vazifalari ro'yxati (§7.1, P4.09): narx bahosi (`el_estimate`, dry_run) va AUDIO holati.
 * Tartib muhim: avval voiceover (TTS-first timing), keyin musiqa (video uzunligiga), SFX, manba audio.
 */
import type { AudioKind, VideoSpec } from "@aes/shared";

/** Default TTS modeli: o'zbekcha faqat v4 da (Q7). */
export const DEFAULT_TTS_MODEL = "eleven_v4";

export type AudioRole =
  "voiceover" | "music" | `sfx:${string}` | "source_isolate" | "source_stt" | "vo_align";

export interface AudioPlanItem {
  role: AudioRole;
  kind: AudioKind;
  label: string;
  params: Record<string, unknown>;
  /** Kirish fayli: loyiha asset kaliti (panel ovozni ajratadi). */
  inputAsset?: string;
  /** Video uzunligi ma'lum bo'lgandan keyin (musiqa `match_video`). */
  afterTiming?: boolean;
}

export interface PronunciationLocator {
  pronunciation_dictionary_id: string;
  version_id: string;
}

const assetKey = (ref: string) => ref.replace(/^asset:/, "");

export function clampMusicMs(seconds: number): number {
  return Math.min(600_000, Math.max(3_000, Math.round(seconds * 1000)));
}

/**
 * @param videoDuration — musiqa `match_video` uchun (null bo'lsa: rejada `afterTiming`, bahoda sahnalar yig'indisi).
 */
export function planAudioTasks(
  spec: VideoSpec,
  options: { videoDuration: number | null; dictionaries?: Record<string, PronunciationLocator> } = {
    videoDuration: null,
  },
): AudioPlanItem[] {
  const audio = spec.audio;
  if (audio === undefined) return [];
  const items: AudioPlanItem[] = [];
  const vo = audio.voiceover;
  if (vo?.kind === "tts") {
    const locators = vo.pronunciation
      .map((slug) => options.dictionaries?.[slug])
      .filter((value): value is PronunciationLocator => value !== undefined);
    items.push({
      role: "voiceover",
      kind: "tts",
      label: "Voiceover (TTS)",
      params: {
        voice_id: vo.voice_id,
        text: vo.text,
        model_id: vo.model_id ?? DEFAULT_TTS_MODEL,
        ...(vo.language === undefined ? {} : { language_code: vo.language }),
        ...(vo.voice_settings === undefined ? {} : { voice_settings: vo.voice_settings }),
        ...(locators.length === 0 ? {} : { pronunciation_dictionary_locators: locators }),
      },
    });
  } else if (vo?.kind === "dialogue") {
    items.push({
      role: "voiceover",
      kind: "dialogue",
      label: "Voiceover (dialog)",
      params: {
        inputs: vo.lines.map((line) => ({ text: line.text, voice_id: line.voice_id })),
        ...(vo.model_id === undefined ? {} : { model_id: vo.model_id }),
      },
    });
  } else if (vo?.kind === "asset" && vo.text !== undefined) {
    items.push({
      role: "vo_align",
      kind: "align",
      label: "Voiceover so'z vaqtlari (alignment)",
      params: { text: vo.text },
      inputAsset: assetKey(vo.asset),
    });
  }

  const musicSpec = audio.music;
  if (musicSpec?.kind === "music") {
    const seconds =
      musicSpec.length === "match_video"
        ? (options.videoDuration ??
          spec.scenes.reduce(
            (sum, scene) => sum + (typeof scene.dur === "number" ? scene.dur : 0),
            0,
          ))
        : musicSpec.length;
    items.push({
      role: "music",
      kind: "music",
      label: "Fon musiqa",
      params: {
        prompt: musicSpec.prompt,
        music_length_ms: clampMusicMs(seconds),
        force_instrumental: musicSpec.instrumental,
      },
      afterTiming: musicSpec.length === "match_video",
    });
  }

  for (const sfx of audio.sfx) {
    if (sfx.prompt === undefined) continue;
    items.push({
      role: `sfx:${sfx.id}`,
      kind: "sfx",
      label: `SFX ${sfx.id}`,
      params: {
        text: sfx.prompt,
        ...(sfx.duration_s === undefined ? {} : { duration_seconds: sfx.duration_s }),
      },
    });
  }

  const source = audio.source_audio;
  if (source !== undefined) {
    const key = assetKey(source.asset);
    if (source.isolate) {
      items.push({
        role: "source_isolate",
        kind: "isolate",
        label: "Ovozni tozalash",
        params: {},
        inputAsset: key,
      });
    }
    const captionsFromSource = audio.captions?.from === "source_audio";
    if (source.transcribe || captionsFromSource) {
      items.push({
        role: "source_stt",
        kind: "stt",
        label: "Transkript (Scribe)",
        params: {
          model_id: "scribe_v2",
          diarize: true,
          ...(source.language === undefined ? {} : { language_code: source.language }),
        },
        inputAsset: key,
      });
    }
  }
  return items;
}
