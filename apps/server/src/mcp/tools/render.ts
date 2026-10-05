/**
 * RENDER toollari (§8): render_presets, render_start (yakunlangan job'ni qayta render, masalan boshqa preset bilan).
 * Odatiy oqimda render verify_approve'dan keyin job ichida avtomatik bo'ladi.
 */
import { OUTPUT_PRESETS, RENDER_PRESETS, ok } from "@aes/shared";
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
      "Renders an already finished (DONE) job again, optionally with another preset. Runs in the background: poll job_status (renders[]). Never overwrites: a new file name is chosen if needed. During VERIFY use verify_approve instead — it renders automatically.",
    input: z.object({
      job_id: uuidArg("job_id"),
      preset: z.enum(OUTPUT_PRESETS).optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      const started = await ctx.engine.renderAgain(job.data.id, input.preset);
      if (!started.ok) return started;
      return ok({ started: true, job: await jobView(ctx, job.data, 3) });
    },
  }),
];
