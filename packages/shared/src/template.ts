/**
 * Shablon manifesti `templates/<slug>/template.json` (ae-studio-plan.md §11.2).
 *
 * Ikki xil manba:
 * - `aep` — dizayner tayyorlagan (yoki `template_save` bilan saqlangan) `template.aep`: `template.instantiate`
 *   opi uni import qiladi, comp nusxasidagi layerlarni slotlar bilan to'ldiradi va sahnaga qo'yadi;
 * - `recipe` — layer retsepti (Spec layerlari, `{{slot}}` va `{{brand.*}}` o'rinbosarlari bilan): compiler uni
 *   oddiy oplarga yoyadi, `.aep` fayl kerak emas (boshlang'ich kutubxona shu turda — qayta yaratsa bo'ladi).
 */
import { z } from "zod";
import { parseWith, slugSchema } from "./common";
import type { Result } from "./result";
import { ASPECTS, FITS } from "./spec";

const layerNameSchema = z.string().min(1).max(255);
const slotDefault = z.union([z.string().max(2000), z.number(), z.boolean()]);

export const TEMPLATE_SOURCES = ["aep", "recipe"] as const;
export const SLOT_NAME_RE = /^[a-z0-9_]{1,64}$/;

export const templateSlotSchema = z.discriminatedUnion(
  "type",
  [
    z.strictObject({
      type: z.literal("text"),
      /** `aep`: shablon comp'idagi matn layer nomi. */
      layer: layerNameSchema.optional(),
      max_chars: z.number().int().min(1).max(2000).optional(),
      default: slotDefault.optional(),
      label: z.string().max(100).optional(),
    }),
    z.strictObject({
      type: z.literal("media"),
      /** `aep`: almashtiriladigan placeholder layer nomi. */
      layer: layerNameSchema.optional(),
      fit: z.enum(FITS).default("cover"),
      default: slotDefault.optional(),
      label: z.string().max(100).optional(),
    }),
    z.strictObject({
      type: z.literal("color"),
      /** `aep`: Essential Graphics xususiyati (yoki shu nomli "Color Control" effekti). */
      egp: z.string().min(1).max(255).optional(),
      default: slotDefault.optional(),
      label: z.string().max(100).optional(),
    }),
  ],
  { error: "Slot 'type' quyidagilardan biri bo'lishi kerak: text, media, color" },
);

/** Server storage'idagi fayl (`template_save` yoki yuklash bilan); manifestga server yozadi. */
const storedFileSchema = z.strictObject({
  storage_key: z.string().min(1).max(512),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().min(0),
});

export const templateManifestSchema = z
  .strictObject({
    slug: slugSchema,
    source: z.enum(TEMPLATE_SOURCES).default("aep"),
    /** `aep`: `template.aep` ichidagi asosiy comp nomi. */
    comp: z.string().min(1).max(255).optional(),
    duration: z
      .strictObject({
        min: z.number().positive().max(3600),
        max: z.number().positive().max(3600),
        stretch: z.enum(["time_remap", "none"]).default("time_remap"),
      })
      .refine((d) => d.min <= d.max, { error: "duration.min ≤ duration.max bo'lishi kerak" }),
    formats: z.array(z.enum(ASPECTS)).min(1),
    slots: z.record(
      z.string().regex(SLOT_NAME_RE, { error: "Slot nomi: kichik harf, raqam, '_'" }),
      templateSlotSchema,
    ),
    /** `recipe`: Spec layerlari (`{{slot}}`, `{{brand.primary}}` …); compiler o'rinbosarlardan keyin tekshiradi. */
    layers: z.array(z.record(z.string(), z.unknown())).min(1).max(50).optional(),
    /** `recipe`: sahna foni (`#RRGGBB` yoki `{{slot}}` / `{{brand.*}}`). */
    bg: z.string().max(64).optional(),
    title: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    tags: z.array(z.string().min(1).max(32)).max(10).optional(),
    files: z
      .strictObject({ aep: storedFileSchema.optional(), preview: storedFileSchema.optional() })
      .optional(),
  })
  .superRefine((m, ctx) => {
    const issue = (path: PropertyKey[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (m.source === "recipe") {
      if (m.layers === undefined) issue(["layers"], "recipe shablonida 'layers' kerak");
      return;
    }
    if (m.comp === undefined) issue(["comp"], "aep shablonida 'comp' (comp nomi) kerak");
    if (m.layers !== undefined) issue(["layers"], "'layers' faqat recipe shablonida");
    for (const [name, slot] of Object.entries(m.slots)) {
      if (slot.type === "color" ? slot.egp === undefined : slot.layer === undefined) {
        issue(
          ["slots", name],
          slot.type === "color" ? "aep shablonida 'egp' kerak" : "aep shablonida 'layer' kerak",
        );
      }
    }
  });

export type TemplateManifest = z.output<typeof templateManifestSchema>;
export type TemplateManifestInput = z.input<typeof templateManifestSchema>;
export type TemplateSlot = z.output<typeof templateSlotSchema>;

export function parseTemplateManifest(input: unknown): Result<TemplateManifest> {
  return parseWith(templateManifestSchema, input, "SYS_BAD_REQUEST");
}
