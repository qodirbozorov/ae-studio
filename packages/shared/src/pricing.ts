/**
 * Narx siyosati (Faza 8, ae-studio-phases.md §7d). Balans dollarda; ichkarida mikro-dollar (1e-6 $).
 * - Pro (tashqi audio xizmati): tannarx × 1.2 × 2.
 * - TTS / dialog / ovoz dizayni: tannarxda (ustamasiz).
 * - Oddiy variantlar (server isolation, kutubxona musiqasi): pro narxining 1/10 qismi.
 * - Keshdan qayta olingan natija: mijoz narxining yarmi (tannarx 0).
 * - Timeline: daqiqasiga, job uchun bir marta (patch va qayta build bepul).
 * Tannarx stavkalari 2026-10 holatiga (tashqi xizmat API narxlari); admin keyin o'zgartiradi (P9.04).
 */
import type { AudioKind } from "./audio";

export const MICROS_PER_USD = 1_000_000;

export interface PricingRates {
  /** Pro ustamasi: 1.2 × 2. */
  markup: number;
  /** Oddiy variant = pro narxi × shu koeffitsient. */
  basicRatio: number;
  /** Keshdan olingan natija = narx × shu koeffitsient. */
  cachedRatio: number;
  /** Timeline (montaj), $ / daqiqa. */
  timelinePerMinute: number;
  /** Ishlatishni boshlash uchun boshlang'ich to'lov, $. */
  activationUsd: number;
  /** Tannarx (tashqi xizmat), $. */
  cost: {
    ttsPer1kChars: number;
    ttsFlashPer1kChars: number;
    musicPerMinute: number;
    sfxPerMinute: number;
    sttPerHour: number;
    isolatePerMinute: number;
    /** Taxminiy — rasmiy narx tasdiqlanmagan. */
    voiceChangePerMinute: number;
    /** Taxminiy — rasmiy narx tasdiqlanmagan. */
    dubPerMinute: number;
  };
}

export const DEFAULT_RATES: PricingRates = {
  markup: 1.2 * 2,
  basicRatio: 0.1,
  cachedRatio: 0.5,
  timelinePerMinute: 0.01,
  activationUsd: 20,
  cost: {
    ttsPer1kChars: 0.1,
    ttsFlashPer1kChars: 0.05,
    musicPerMinute: 0.15,
    sfxPerMinute: 0.12,
    sttPerHour: 0.22,
    isolatePerMinute: 0.12,
    voiceChangePerMinute: 0.12,
    dubPerMinute: 0.5,
  },
};

/** pro — tashqi xizmat; basic — serverdagi oddiy variant (DeepFilterNet, kutubxona). */
export type AudioTier = "pro" | "basic";

export interface PriceQuote {
  /** Ledger yozuvi nomi: `music.pro`, `isolate.basic`, `tts`, `timeline` ... */
  item: string;
  quantity: number;
  unit: "chars" | "seconds" | "minutes";
  costUsd: number;
  priceUsd: number;
}

/** Tannarxda sotiladigan turlar (ustamasiz). */
const AT_COST: ReadonlySet<AudioKind> = new Set(["tts", "dialogue", "voice_design"]);
/** Oddiy (server) varianti bor turlar. */
const HAS_BASIC: ReadonlySet<AudioKind> = new Set(["isolate", "music"]);

function chars(value: unknown): number {
  return typeof value === "string" ? [...value].length : 0;
}

function round6(value: number): number {
  return Math.round(value * MICROS_PER_USD) / MICROS_PER_USD;
}

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

/** Turga ko'ra hajm va tannarx (ustamasiz). `seconds` — haqiqiy yoki taxminiy davomiylik. */
function baseCost(
  kind: AudioKind,
  params: Record<string, unknown>,
  seconds: number | null,
  rates: PricingRates,
): { quantity: number; unit: PriceQuote["unit"]; costUsd: number } {
  const c = rates.cost;
  const minutes = (s: number) => s / 60;
  switch (kind) {
    case "tts":
    case "voice_design": {
      const n = chars(params.text);
      const flash = /flash|turbo/.test(String(params.model_id ?? ""));
      return {
        quantity: n,
        unit: "chars",
        costUsd: (n / 1000) * (flash ? c.ttsFlashPer1kChars : c.ttsPer1kChars),
      };
    }
    case "dialogue": {
      const inputs = Array.isArray(params.inputs) ? (params.inputs as { text?: unknown }[]) : [];
      const n = inputs.reduce((sum, line) => sum + chars(line.text), 0);
      return { quantity: n, unit: "chars", costUsd: (n / 1000) * c.ttsPer1kChars };
    }
    case "music": {
      const plan = params.composition_plan as { sections?: { duration_ms: number }[] } | undefined;
      const requested =
        (plan?.sections?.reduce((sum, section) => sum + section.duration_ms, 0) ??
          (typeof params.music_length_ms === "number" ? params.music_length_ms : 30_000)) / 1000;
      const s = seconds ?? requested;
      return { quantity: s, unit: "seconds", costUsd: minutes(s) * c.musicPerMinute };
    }
    case "sfx": {
      const s =
        seconds ?? (typeof params.duration_seconds === "number" ? params.duration_seconds : 5);
      return { quantity: s, unit: "seconds", costUsd: minutes(s) * c.sfxPerMinute };
    }
    case "stt":
    case "align": {
      const s = seconds ?? 0;
      return { quantity: s, unit: "seconds", costUsd: (s / 3600) * c.sttPerHour };
    }
    case "isolate": {
      const s = seconds ?? 0;
      return { quantity: s, unit: "seconds", costUsd: minutes(s) * c.isolatePerMinute };
    }
    case "voice_change": {
      const s = seconds ?? 0;
      return { quantity: s, unit: "seconds", costUsd: minutes(s) * c.voiceChangePerMinute };
    }
    case "dub": {
      const s = seconds ?? 0;
      return { quantity: s, unit: "seconds", costUsd: minutes(s) * c.dubPerMinute };
    }
  }
}

/**
 * Audio vazifasi narxi. `seconds`: kirish audiosi uzunligi (stt/isolate/...) yoki natija uzunligi
 * (musiqa/sfx); null — taxmin (so'ralgan uzunlik).
 */
export function quoteAudio(
  kind: AudioKind,
  params: Record<string, unknown>,
  seconds: number | null,
  options: { tier?: AudioTier; cached?: boolean } = {},
  rates: PricingRates = DEFAULT_RATES,
): PriceQuote {
  const tier: AudioTier = HAS_BASIC.has(kind) ? (options.tier ?? "pro") : "pro";
  const base = baseCost(kind, params, seconds, rates);
  const proPrice = AT_COST.has(kind) ? base.costUsd : base.costUsd * rates.markup;
  let priceUsd = tier === "basic" ? proPrice * rates.basicRatio : proPrice;
  let costUsd = tier === "basic" ? 0 : base.costUsd;
  if (options.cached === true) {
    priceUsd *= rates.cachedRatio;
    costUsd = 0;
  }
  return {
    item: HAS_BASIC.has(kind) ? `${kind}.${tier}` : kind,
    quantity: round6(base.quantity),
    unit: base.unit,
    costUsd: round6(costUsd),
    priceUsd: round6(priceUsd),
  };
}

/** Timeline narxi: yakuniy video uzunligi × formatlar soni (asosiy + variantlar). */
export function quoteTimeline(
  seconds: number,
  formats = 1,
  rates: PricingRates = DEFAULT_RATES,
): PriceQuote {
  const minutes = (seconds / 60) * Math.max(1, formats);
  return {
    item: "timeline",
    quantity: round6(minutes),
    unit: "minutes",
    costUsd: 0,
    priceUsd: round6(minutes * rates.timelinePerMinute),
  };
}
