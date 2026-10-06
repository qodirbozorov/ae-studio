/**
 * Batch toollari (§11.4.3, P5.07): batch_start, batch_status, batch_cancel.
 */
import { ASPECTS, fail, ok, slugSchema } from "@aes/shared";
import { z } from "zod";
import { batchReport, presentBatch } from "../../batch/service";
import { defineTool } from "../registry";
import { ownProject, uuidArg } from "./common";

export const batchTools = [
  defineTool({
    name: "batch_start",
    title: "Start batch",
    description:
      "Template + CSV → one video per row. The CSV header names columns; by default a column whose name equals a slot fills that slot (or pass mapping {column: slot}); an optional 'name' column sets the output file name. All rows are validated first (SPEC_INVALID lists bad rows); then jobs run one after another without VERIFY (auto-approved), each with its own render. Poll batch_status.",
    input: z.object({
      project_id: uuidArg("project_id"),
      template: slugSchema,
      csv: z.string().min(1).max(1_000_000),
      mapping: z
        .record(z.string().min(1).max(100), z.string().regex(/^[a-z0-9_]{1,64}$/))
        .optional(),
      format: z.enum(ASPECTS).optional(),
      variants: z.array(z.enum(ASPECTS)).max(3).optional(),
      dur: z.number().positive().max(3600).optional(),
      brand: slugSchema.optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const started = await ctx.app.batches.start(ctx.userId, {
        projectId: project.data.id,
        template: input.template,
        csv: input.csv,
        mapping: input.mapping,
        format: input.format,
        variants: input.variants,
        dur: input.dur,
        brand: input.brand,
      });
      if (!started.ok) return started;
      return ok(presentBatch(started.data));
    },
  }),

  defineTool({
    name: "batch_status",
    title: "Batch status",
    description:
      "Batch progress: per row status (pending/running/done/failed), job_id, output MP4 paths or the error; report (markdown table) when finished.",
    input: z.object({ batch_id: uuidArg("batch_id") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const batch = await ctx.app.batches.get(ctx.userId, input.batch_id);
      if (batch === null) return fail("SYS_NOT_FOUND", "Batch topilmadi");
      return ok({ ...presentBatch(batch), report: batchReport(batch) });
    },
  }),

  defineTool({
    name: "batch_cancel",
    title: "Cancel batch",
    description:
      "Stops a running batch: pending rows are marked failed, the running job is cancelled.",
    input: z.object({ batch_id: uuidArg("batch_id") }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const cancelled = await ctx.app.batches.cancel(ctx.userId, input.batch_id);
      if (!cancelled.ok) return cancelled;
      return ok(presentBatch(cancelled.data));
    },
  }),
];
