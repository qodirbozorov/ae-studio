/**
 * Rasmlar (Unsplash): qidirish, loyihaga olish va mualliflar. Fayl foydalanuvchi kompyuterida (`source/unsplash/`)
 * oddiy asset bo'ladi — spec'da `asset:<key>`. Qoidalar: rasmni foydalanuvchi tanlaydi/tasdiqlaydi, nashrda muallif
 * ("Photo by X on Unsplash") ko'rsatiladi; Unsplash kontenti AI o'qitishda ishlatilmaydi.
 */
import { fail, ok, parseSpec } from "@aes/shared";
import { z } from "zod";
import { importUnsplash, projectCredits } from "../../stock/import";
import { COLORS } from "../../stock/unsplash";
import type { Orientation } from "../../stock/unsplash";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { ownProject, requireOnline, uuidArg } from "./common";

/** Loyihaning so'nggi plan formati (bo'lmasa null). */
async function planFormat(
  ctx: ToolContext,
  projectId: string,
): Promise<{ w: number; h: number } | null> {
  const plan = await ctx.engine.plan(projectId);
  if (plan === null) return null;
  const spec = parseSpec(plan.spec);
  return spec.ok ? { w: spec.data.format.w, h: spec.data.format.h } : null;
}

function orientationOf(format: { w: number; h: number }): Orientation {
  const r = format.w / format.h;
  return r > 1.15 ? "landscape" : r < 0.87 ? "portrait" : "squarish";
}

const notConfigured = () =>
  fail(
    "SYS_BAD_REQUEST",
    "Rasmlar xizmati sozlanmagan (administrator: admin → Rasmlar, Unsplash kaliti)",
  );

export const imageTools = [
  defineTool({
    name: "images_search",
    title: "Search stock photos",
    description:
      'Searches Unsplash photos (free license) for backgrounds, b-roll and illustrative stills when the project\'s own source/ files don\'t cover a scene — check assets_list first. Write the query in English, 1–4 concrete words ("cotton field sunrise", "modern office desk"). orientation defaults to the project\'s plan format (9:16 → portrait). Returns id, description, size, dominant color, author and a small thumb URL (Unsplash CDN) — show the user 3–6 options with author names and let them choose before images_import; do not import silently. Each search costs from a shared hourly quota: search once per subject, reuse results.',
    input: z.object({
      query: z.string().trim().min(2).max(100),
      project_id: uuidArg("project_id")
        .optional()
        .describe("Orientation from this project's plan format"),
      orientation: z.enum(["landscape", "portrait", "squarish"]).optional(),
      color: z.enum(COLORS).optional().describe("Dominant color filter, e.g. to match the brand"),
      count: z.number().int().min(1).max(30).default(12),
      page: z.number().int().min(1).max(20).default(1),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      if (!(await ctx.app.unsplash.configured())) return notConfigured();
      let orientation = input.orientation;
      if (orientation === undefined && input.project_id !== undefined) {
        const project = await ownProject(ctx, input.project_id);
        if (!project.ok) return project;
        const format = await planFormat(ctx, project.data.id);
        if (format !== null) orientation = orientationOf(format);
      }
      const found = await ctx.app.unsplash.search({
        query: input.query,
        count: input.count,
        page: input.page,
        ...(orientation === undefined ? {} : { orientation }),
        ...(input.color === undefined ? {} : { color: input.color }),
      });
      if (!found.ok) return found;
      return ok({
        total: found.data.total,
        orientation: orientation ?? null,
        photos: found.data.photos,
        next_step:
          found.data.photos.length === 0
            ? "Nothing found — try broader English words or drop color/orientation."
            : "Show the user a few options (description, author, thumb), then images_import the chosen id.",
      });
    },
  }),

  defineTool({
    name: "images_import",
    title: "Import a stock photo",
    description:
      "Downloads a chosen Unsplash photo (id from images_search) straight from the Unsplash CDN into the project's source/unsplash/ folder on the user's computer (the panel must be online) and registers it as an asset — use the returned ref (asset:unsplash_…) in the spec like any media file (fit cover/contain, ken_burns…). width defaults to 1.25× the plan's larger side (max 4000 px); importing the same photo again returns the existing asset. Tell the user the attribution line when they publish.",
    input: z.object({
      project_id: uuidArg("project_id"),
      photo_id: z.string().trim().min(4).max(64),
      width: z
        .number()
        .int()
        .min(400)
        .max(6000)
        .optional()
        .describe("File width in px (height keeps the aspect)"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      if (!(await ctx.app.unsplash.configured())) return notConfigured();
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const deviceId = requireOnline(ctx, project.data);
      if (!deviceId.ok) return deviceId;
      const format = await planFormat(ctx, project.data.id);
      const width =
        input.width ??
        Math.min(4000, Math.round(Math.max(format?.w ?? 1920, format?.h ?? 1080) * 1.25));
      const imported = await importUnsplash(
        ctx.app,
        project.data,
        deviceId.data,
        input.photo_id,
        width,
      );
      if (!imported.ok) return imported;
      return ok({
        ...imported.data,
        next_step: `Use "${imported.data.ref}" as a media src in the spec. Attribution for publishing: ${imported.data.attribution}.`,
      });
    },
  }),

  defineTool({
    name: "images_credits",
    title: "Photo credits",
    description:
      'Lists the Unsplash photos imported into the project with attribution lines ("Photo by X on Unsplash" + links) — give them to the user for the video description or credits when publishing.',
    input: z.object({ project_id: uuidArg("project_id") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const credits = await projectCredits(ctx.app, project.data.id);
      return ok({
        photos: credits,
        text: credits.map((c) => `${c.attribution} — ${c.photo_url}`).join("\n") || null,
      });
    },
  }),
];
