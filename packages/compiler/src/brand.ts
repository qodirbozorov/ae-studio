/**
 * Brand kit (§11.3) compiler'da: matn shrifti va rangi default'lari, AE'dagi shriftlar bo'yicha fallback
 * (topilmasa `AE_FONT_MISSING`). AE shriftlar ro'yxati noma'lum bo'lsa (AE < 24) nomlar o'zgarishsiz qoladi.
 */
import { fail, ok } from "@aes/shared";
import type { Brand, Layer, Result } from "@aes/shared";

export interface Look {
  /** Spec/shablon shrifti (yoki brand body shrifti) → AE'da mavjud PostScript nomi. */
  font(name: string | undefined): string | undefined;
  /** Matn default rangi. */
  color: string;
}

/**
 * Ishlatiladigan barcha shriftlarni oldindan tekshiradi. `available` — AE'dagi PostScript nomlari
 * (null/undefined — noma'lum). Brand shriftlari uchun fallback ro'yxati sinaladi.
 */
export function buildLook(
  layers: readonly Layer[],
  brand: Brand | undefined,
  available: readonly string[] | null | undefined,
  warnings: string[],
): Result<Look> {
  const fallbacks = new Map<string, string[]>();
  if (brand !== undefined) {
    fallbacks.set(brand.fonts.heading.family, brand.fonts.heading.fallback);
    fallbacks.set(brand.fonts.body.family, brand.fonts.body.fallback);
  }
  const defaultFont = brand?.fonts.body.family;
  const resolved = new Map<string, string>();
  if (available !== null && available !== undefined) {
    const have = new Set(available);
    const wanted = new Set<string>();
    for (const layer of layers) {
      if (layer.type !== "text") continue;
      const font = layer.style.font ?? defaultFont;
      if (font !== undefined) wanted.add(font);
    }
    for (const font of wanted) {
      if (have.has(font)) {
        resolved.set(font, font);
        continue;
      }
      const chain = fallbacks.get(font) ?? [];
      const found = chain.find((candidate) => have.has(candidate));
      if (found === undefined) {
        return fail(
          "AE_FONT_MISSING",
          `Shrift AE'da yo'q: ${font}${chain.length > 0 ? ` (fallback ham yo'q: ${chain.join(", ")})` : ""}`,
          { font, fallback: chain },
        );
      }
      warnings.push(`Shrift ${font} AE'da yo'q — fallback ${found} ishlatiladi`);
      resolved.set(font, found);
    }
  }
  return ok({
    font: (name) => {
      const font = name ?? defaultFont;
      return font === undefined ? undefined : (resolved.get(font) ?? font);
    },
    color: brand?.colors.text ?? "#FFFFFF",
  });
}
