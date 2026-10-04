/** Brand kit `brands/<slug>/brand.json` (ae-studio-plan.md §11.3). */
import { z } from "zod";
import { assetRefSchema, hexColorSchema, parseWith, slugSchema } from "./common";
import type { Result } from "./result";

const fontSchema = z.strictObject({
  /** PostScript nomi (masalan `Montserrat-Bold`). */
  family: z.string().min(1).max(128),
  /** Asosiy shrift AE'da bo'lmasa navbat bilan sinaladi (PREFLIGHT, `AE_FONT_MISSING`). */
  fallback: z.array(z.string().min(1).max(128)).max(5).default([]),
});

export const brandSchema = z.strictObject({
  slug: slugSchema,
  name: z.string().min(1).max(100),
  colors: z.strictObject({
    primary: hexColorSchema,
    secondary: hexColorSchema.optional(),
    accent: hexColorSchema.optional(),
    text: hexColorSchema.default("#FFFFFF"),
    background: hexColorSchema.default("#000000"),
  }),
  fonts: z.strictObject({
    heading: fontSchema,
    body: fontSchema,
  }),
  logo: assetRefSchema.optional(),
  captions: z
    .strictObject({
      style: slugSchema.default("karaoke_bold"),
      highlight: hexColorSchema.optional(),
    })
    .default({ style: "karaoke_bold" }),
  /** Default ovoz (ElevenLabs). */
  voice: z
    .strictObject({
      voice_id: z.string().min(1).max(64),
      model_id: z.string().min(1).max(64).optional(),
    })
    .optional(),
  /** Default musiqa uslubi (music prompt uchun). */
  music_style: z.string().min(1).max(300).optional(),
});

export type Brand = z.output<typeof brandSchema>;

export function parseBrand(input: unknown): Result<Brand> {
  return parseWith(brandSchema, input, "SYS_BAD_REQUEST");
}
