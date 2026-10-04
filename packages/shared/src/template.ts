/** Shablon manifesti `templates/<slug>/template.json` (ae-studio-plan.md §11.2). */
import { z } from "zod";
import { parseWith, slugSchema } from "./common";
import type { Result } from "./result";
import { ASPECTS, FITS } from "./spec";

const layerNameSchema = z.string().min(1).max(255);

export const templateSlotSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("text"),
      /** Shablon comp'idagi matn layer nomi. */
      layer: layerNameSchema,
      max_chars: z.number().int().min(1).max(2000).optional(),
    }),
    z.strictObject({
      type: z.literal("media"),
      /** Almashtiriladigan placeholder layer nomi. */
      layer: layerNameSchema,
      fit: z.enum(FITS).default("cover"),
    }),
    z.strictObject({
      type: z.literal("color"),
      /** Essential Graphics xususiyati nomi. */
      egp: z.string().min(1).max(255),
    }),
  ],
  { error: "Slot 'type' quyidagilardan biri bo'lishi kerak: text, media, color" },
);

export const templateManifestSchema = z.strictObject({
  slug: slugSchema,
  /** `template.aep` ichidagi asosiy comp nomi. */
  comp: z.string().min(1).max(255),
  duration: z
    .strictObject({
      min: z.number().positive().max(3600),
      max: z.number().positive().max(3600),
      stretch: z.enum(["time_remap", "none"]).default("time_remap"),
    })
    .refine((d) => d.min <= d.max, { error: "duration.min ≤ duration.max bo'lishi kerak" }),
  formats: z.array(z.enum(ASPECTS)).min(1),
  slots: z.record(
    z.string().regex(/^[a-z0-9_]{1,64}$/, { error: "Slot nomi: kichik harf, raqam, '_'" }),
    templateSlotSchema,
  ),
  title: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
});

export type TemplateManifest = z.output<typeof templateManifestSchema>;
export type TemplateSlot = z.output<typeof templateSlotSchema>;

export function parseTemplateManifest(input: unknown): Result<TemplateManifest> {
  return parseWith(templateManifestSchema, input, "SYS_BAD_REQUEST");
}
