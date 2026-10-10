/**
 * RENDER toollari (§8): render_presets, render_start (yakunlangan job'ni qayta render, masalan boshqa preset bilan).
 * Render faqat foydalanuvchi aniq so'raganda (user_confirmed) — u foydalanuvchi kompyuterini band qiladi.
 */
import { fail, OUTPUT_PRESETS, RENDER_PRESETS, ok } from "@aes/shared";
import { z } from "zod";
import { defineTool } from "../registry";
import { jobView, ownJob } from "./build";
import { uuidArg } from "./common";

export const renderTools = [
  defineTool({
    name: "render_presets",
    title: "Render presets",
    description:
      "Output presets for the final MP4 (spec output.preset / render_start). The video is rendered by After Effects (aerender) and encoded by ffmpeg on the user's machine into out/.",
    input: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async handler() {
      return ok(OUTPUT_PRESETS.map((id) => ({ id, ...RENDER_PRESETS[id] })));
    },
  }),

  defineTool({
    name: "render_start",
    title: "Render again",
    description:
      "Renders a finished (DONE) job to MP4 (aerender on the user's computer — heavy, the computer stays busy). Call it ONLY when the user explicitly asked to render in this conversation and pass user_confirmed: true; otherwise the user reviews the result in the After Effects timeline. Runs in the background: poll job_status (renders[]). Never overwrites: a new file name is chosen if needed.",
    input: z.object({
      job_id: uuidArg("job_id"),
      preset: z.enum(OUTPUT_PRESETS).optional(),
      user_confirmed: z
        .boolean()
        .describe("true only if the user explicitly asked to render in this conversation"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      if (!input.user_confirmed) {
        return fail(
          "RENDER_NOT_CONFIRMED",
          "Render faqat foydalanuvchi aniq ruxsat berganda (user_confirmed: true)",
        );
      }
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      const started = await ctx.engine.renderAgain(job.data.id, input.preset);
      if (!started.ok) return started;
      return ok({ started: true, job: await jobView(ctx, job.data, 3) });
    },
  }),
];
