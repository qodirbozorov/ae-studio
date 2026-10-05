/**
 * Kredit bahosi (§7.1, `el_estimate`): ElevenLabs belgi/kredit hisobi bo'yicha taxminiy qiymat.
 * - TTS / dialogue: belgilar soni (Flash/Turbo modellar ~0.5×).
 * - SFX: ~40 kredit/soniya (davomiylik berilmasa ~200).
 * - Music: ~10 kredit/soniya (taxminiy).
 * - STT, alignment, isolation, voice changer, dubbing: kirish audiosi davomiyligiga ko'ra (minutiga).
 * Aniq narx ElevenLabs tarifiga bog'liq — natija `approximate: true` bilan qaytariladi.
 */
import type { AudioKind } from "@aes/shared";

const PER_MINUTE: Partial<Record<AudioKind, number>> = {
  stt: 0,
  align: 0,
  isolate: 1000,
  voice_change: 1000,
  dub: 3000,
};

export interface EstimateInput {
  kind: AudioKind;
  params: Record<string, unknown>;
  /** Kirish audiosi davomiyligi (soniya), ma'lum bo'lsa. */
  inputSeconds?: number | null;
}

function chars(value: unknown): number {
  return typeof value === "string" ? [...value].length : 0;
}

export function estimateCredits(input: EstimateInput): number {
  const { kind, params } = input;
  switch (kind) {
    case "tts": {
      const model = String(params.model_id ?? "");
      const factor = /flash|turbo/.test(model) ? 0.5 : 1;
      return Math.ceil(chars(params.text) * factor);
    }
    case "dialogue": {
      const inputs = Array.isArray(params.inputs) ? (params.inputs as { text?: unknown }[]) : [];
      return inputs.reduce((sum, line) => sum + chars(line.text), 0);
    }
    case "sfx":
      return typeof params.duration_seconds === "number"
        ? Math.ceil(params.duration_seconds * 40)
        : 200;
    case "music": {
      const plan = params.composition_plan as { sections?: { duration_ms: number }[] } | undefined;
      const ms =
        plan?.sections?.reduce((sum, section) => sum + section.duration_ms, 0) ??
        (typeof params.music_length_ms === "number" ? params.music_length_ms : 30_000);
      return Math.ceil((ms / 1000) * 10);
    }
    case "voice_design":
      return chars(params.text) || 100;
    default: {
      const perMinute = PER_MINUTE[kind] ?? 0;
      const seconds = input.inputSeconds ?? 0;
      return Math.ceil((seconds / 60) * perMinute);
    }
  }
}
