/** Musiqa kutubxonasi (P8.06–P8.07): qidiruv. Kutubxona — sukut bo'yicha; generatsiya faqat mos trek yo'q bo'lsa. */
import { ok } from "@aes/shared";
import { z } from "zod";
import { defineTool } from "../registry";

export const musicTools = [
  defineTool({
    name: "music_search",
    title: "Search music library",
    description:
      `Searches the background music library (cheap, priced per minute of video; generating new music costs ~10× more and needs the user's confirmation — audio_estimate gives exact prices). Query with mood/genre/instruments/tempo words (e.g. "calm piano corporate", "energetic electronic"); optional category and min_seconds. Use the chosen id in the spec: audio.music = {kind: "library", track: id, duck_under: "voiceover"}. ` +
      "A track shorter than the video is looped automatically with a crossfade (crossfade_s, default 2) and fades out at the end (fade_out_s, default 1.5). For a smooth result prefer: a track at least as long as the video, or one marked loopable; steady instrumental beds over tracks with a strong intro/outro; crossfade 2–4 s for ambient/pads, 1–2 s for rhythmic music. Call with no query to see categories.",
    input: z.object({
      query: z.string().max(200).optional(),
      category: z.string().max(80).optional(),
      min_seconds: z.number().min(0).max(3600).optional(),
      limit: z.number().int().min(1).max(30).default(10),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const result = await ctx.app.music.search(ctx.userId, {
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.min_seconds === undefined ? {} : { minSeconds: input.min_seconds }),
        limit: input.limit,
      });
      const rates = ctx.app.billing.rates;
      const libraryPrice = rates.cost.musicPerMinute * rates.markup * rates.basicRatio;
      return ok({
        ...result,
        price_usd_per_minute: Math.round(libraryPrice * 10_000) / 10_000,
        ...(result.tracks.length === 0
          ? {
              hint:
                result.total_visible === 0
                  ? "Kutubxona hali bo'sh: foydalanuvchi roziligi bilan music_generate (generatsiya) yoki asset musiqa."
                  : "Mos trek topilmadi: boshqa so'zlar yoki kategoriya bilan qidiring; bo'lmasa generatsiya (narxini ayting).",
            }
          : {}),
      });
    },
  }),
];
