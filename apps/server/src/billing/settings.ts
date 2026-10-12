/**
 * Narx sozlamalari (P9.04): admin o'zgartiradigan stavkalar `system_settings.billing` da (faqat farqlar).
 * Kodda — `DEFAULT_RATES`; DB'dagi qiymatlar ustidan yoziladi. Chegaralar xato kiritishdan himoya qiladi
 * (masalan ustama 0 yoki manfiy narx).
 */
import { DEFAULT_RATES } from "@aes/shared";
import type { PricingRates } from "@aes/shared";
import { z } from "zod";

export const BILLING_SETTINGS_KEY = "billing";

const money = (max: number) => z.number().finite().min(0).max(max);

export const ratesPatchSchema = z.strictObject({
  markup: z.number().finite().min(1).max(20).optional(),
  basicRatio: z.number().finite().min(0).max(1).optional(),
  cachedRatio: z.number().finite().min(0).max(1).optional(),
  timelinePerMinute: money(10).optional(),
  activationUsd: money(10_000).optional(),
  cost: z
    .strictObject({
      ttsPer1kChars: money(10).optional(),
      ttsFlashPer1kChars: money(10).optional(),
      musicPerMinute: money(100).optional(),
      sfxPerMinute: money(100).optional(),
      sttPerHour: money(100).optional(),
      isolatePerMinute: money(100).optional(),
      voiceChangePerMinute: money(100).optional(),
      dubPerMinute: money(100).optional(),
    })
    .optional(),
});

export type RatesPatch = z.infer<typeof ratesPatchSchema>;

export const billingSettingsSchema = z.strictObject({
  rates: ratesPatchSchema.optional(),
  /** To'lov uchun murojaat (kabinet va bot ko'rsatadi), masalan `@admin` yoki telefon. */
  contact: z.string().trim().max(200).optional(),
});

export type BillingSettingsValue = z.infer<typeof billingSettingsSchema>;

/** Kod stavkalari + DB'dagi farqlar. */
export function mergeRates(patch: RatesPatch | undefined): PricingRates {
  return {
    ...DEFAULT_RATES,
    ...(patch ?? {}),
    cost: { ...DEFAULT_RATES.cost, ...(patch?.cost ?? {}) },
  } as PricingRates;
}

/** DB yozuvini xavfsiz o'qiydi: buzilgan qiymat bo'lsa kod stavkalari (xato logda). */
export function parseStored(value: unknown): BillingSettingsValue | null {
  const parsed = billingSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
