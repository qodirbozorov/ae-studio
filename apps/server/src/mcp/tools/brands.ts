/**
 * Brand kit toollari (§8, §11.3, P5.04): brands_list, brand_save.
 */
import { brandSchema, ok } from "@aes/shared";
import { z } from "zod";
import { defineTool } from "../registry";

export const brandTools = [
  defineTool({
    name: "brands_list",
    title: "List brand kits",
    description:
      "The user's brand kits: colors, fonts (PostScript names + fallbacks), logo asset, caption style, default voice and music style. A Spec uses one via spec.brand (slug; 'default' if saved).",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx) {
      return ok(await ctx.app.brands.list(ctx.userId));
    },
  }),

  defineTool({
    name: "brand_save",
    title: "Save brand kit",
    description:
      "Creates or updates a brand kit by slug. Applied by the compiler: default text font (body) and color, scene background, template tokens ({{brand.primary}} …, heading font, logo), caption style; the AUDIO step uses voice (when voiceover.voice_id is omitted) and music_style (when music.prompt is omitted). Fonts are checked in AE at PREFLIGHT: missing font → fallback list → AE_FONT_MISSING. Save slug 'default' to apply it to every Spec without spec.brand.",
    input: z.object({ brand: brandSchema }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const saved = await ctx.app.brands.save(ctx.userId, input.brand);
      if (!saved.ok) return saved;
      return ok(saved.data);
    },
  }),
];
