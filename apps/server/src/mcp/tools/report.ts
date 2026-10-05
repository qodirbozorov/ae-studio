/** Hisobot (§8): report_get — yakuniy markdown (chatda ko'rsatish uchun). */
import { fail, ok } from "@aes/shared";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { reports } from "../../db/schema";
import { defineTool } from "../registry";
import { jobView, ownJob } from "./build";
import { uuidArg } from "./common";

export const reportTools = [
  defineTool({
    name: "report_get",
    title: "Get report",
    description:
      "Final report of a job as markdown: what was built, file paths (.aep, rendered MP4 in out/), how to edit it in AE, warnings. Show it to the user. Available once the job reached REPORT/DONE (also for cancelled jobs).",
    input: z.object({ job_id: uuidArg("job_id") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      const [row] = await ctx.app.db
        .select()
        .from(reports)
        .where(eq(reports.jobId, job.data.id))
        .orderBy(desc(reports.createdAt))
        .limit(1);
      if (row === undefined) {
        return fail("JOB_BAD_ACTION", `Hisobot hali yo'q (job holati: ${job.data.state})`);
      }
      const view = await jobView(ctx, job.data, 0);
      return ok({
        markdown: row.markdown,
        outcome: job.data.outcome,
        aep_path: view.aep_path,
        renders: view.renders.filter((render) => render.status === "done"),
        created_at: row.createdAt,
      });
    },
  }),
];
