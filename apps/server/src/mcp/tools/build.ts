/**
 * Qurish toollari (§8): preflight, build_start (+dry_run, §11.4.2), job_status, job_resume, job_cancel, job_list.
 */
import { compile } from "@aes/compiler";
import { collectAssetRefs, fail, ok, parseSpec } from "@aes/shared";
import type { JobState, OpEnvelope, Result, VideoSpec } from "@aes/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { jobEvents, jobs, projects } from "../../db/schema";
import { planAudioTasks } from "../../audio/plan";
import { aepPath, compileAssets } from "../../jobs/engine";
import type { JobRow } from "../../jobs/engine";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { ownProject, uuidArg } from "./common";
import { dictionaries } from "./eleven-common";
import { estimateWithQuota } from "./eleven-voice";
import type { ProjectRow } from "./common";

/** Op turi bo'yicha taxminiy vaqt (soniya; AE + tarmoq). */
const OP_SECONDS: Record<string, number> = {
  "project.open_or_create": 3,
  "project.save": 2,
  "item.import": 1.5,
  "comp.create": 0.4,
  "comp.nest": 0.4,
  "fx.add": 0.6,
  "fx.apply_preset": 0.8,
};

export function estimateSeconds(ops: readonly OpEnvelope[]): number {
  const total = ops.reduce((sum, op) => sum + (OP_SECONDS[op.op] ?? 0.35) + 0.15, 0);
  return Math.round(total);
}

interface MissingRef {
  ref: string;
  reason: "unknown" | "corrupt" | "unsupported" | "missing";
}

/** Spec + joriy assetlar → oplist (job yaratmasdan). */
async function dryCompile(ctx: ToolContext, project: ProjectRow, spec: VideoSpec) {
  const assets = await compileAssets(ctx.app.db, project.id);
  const missing: MissingRef[] = [];
  for (const key of collectAssetRefs(spec)) {
    const asset = assets[key];
    if (asset === undefined) missing.push({ ref: `asset:${key}`, reason: "unknown" });
    else if (asset.status !== undefined && asset.status !== "ok") {
      missing.push({ ref: `asset:${key}`, reason: asset.status });
    }
  }
  const version = await ctx.engine.nextAepVersion(project.id);
  const projectPath = aepPath(project, version);
  const compiled = compile(spec, { assets, projectPath, version });
  return { missing, projectPath, compiled };
}

async function loadSpec(
  ctx: ToolContext,
  project: ProjectRow,
  version: number | undefined,
): Promise<Result<{ version: number; spec: VideoSpec }>> {
  const plan = await ctx.engine.plan(project.id, version);
  if (plan === null) return fail("SYS_NOT_FOUND", "Plan topilmadi (plan_write)");
  const spec = parseSpec(plan.spec);
  if (!spec.ok) return spec;
  return ok({ version: plan.version, spec: spec.data });
}

/** Faqat shu userning job'i. */
export async function ownJob(ctx: ToolContext, jobId: string): Promise<Result<JobRow>> {
  const [row] = await ctx.app.db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(projects, eq(projects.id, jobs.projectId))
    .where(and(eq(jobs.id, jobId), eq(projects.userId, ctx.userId)))
    .limit(1);
  return row === undefined ? fail("SYS_NOT_FOUND", "Job topilmadi (job_list)") : ok(row.job);
}

const NEXT_STEP: Partial<Record<JobState, string>> = {
  WAITING_AGENT:
    "Panel uzilgan: foydalanuvchi After Effects'da AE Studio panelini ochishi kerak, ulanganda job o'zi davom etadi.",
  BLOCKED:
    "error.hint ni o'qing. Sabab tuzatilgach job_resume; SPEC_*/ASSET_* bo'lsa verify_patch (yoki plan_patch + yangi build); boshqa holatda foydalanuvchidan so'rang.",
  VERIFY: "frames_capture bilan kadrlarni ko'ring, keyin verify_approve yoki verify_patch.",
  RENDER: "Render ketmoqda: 10–20 s dan keyin job_status.",
  REPORT: "Hisobot yozilmoqda: biroz kutib report_get.",
  DONE: "report_get bilan hisobotni oling va foydalanuvchiga ko'rsating.",
};

export async function jobView(ctx: ToolContext, job: JobRow, logLimit: number) {
  const progress = await ctx.engine.progress(job.id);
  const [project] = await ctx.app.db
    .select()
    .from(projects)
    .where(eq(projects.id, job.projectId))
    .limit(1);
  const events = await ctx.app.db
    .select()
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, job.id), ne(jobEvents.level, "debug")))
    .orderBy(desc(jobEvents.id))
    .limit(logLimit);
  const next = job.paused
    ? "Pauzada: davom ettirish uchun job_resume."
    : (NEXT_STEP[job.state] ?? "Ishlayapti: 5–10 s dan keyin job_status.");
  return {
    id: job.id,
    project_id: job.projectId,
    state: job.state,
    prev_state: job.prevState,
    paused: job.paused,
    outcome: job.outcome,
    plan_version: job.planVersion,
    patch_count: job.patchCount,
    aep_path:
      project !== undefined && job.aepVersion !== null ? aepPath(project, job.aepVersion) : null,
    progress: {
      ...progress,
      percent: progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100),
    },
    error: job.error,
    renders: (await ctx.engine.rendersOf(job.id)).map((render) => ({
      id: render.id,
      status: render.status,
      preset: render.preset,
      local_path: render.localPath,
      duration_s: render.durationMs === null ? null : render.durationMs / 1000,
      size_bytes: render.sizeBytes,
      method: render.method,
      error: render.error,
    })),
    next_step: next,
    logs: events.reverse().map((event) => ({
      ts: event.ts,
      level: event.level,
      type: event.type,
      op_id: event.opId,
      message: event.message,
    })),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

const jobArg = z.object({ job_id: uuidArg("job_id") });

export const buildTools = [
  defineTool({
    name: "preflight",
    title: "Preflight",
    description:
      "Checks a plan against the scanned files without touching AE: missing[] (unknown/corrupt/missing asset refs), compile errors, op count, scenes, total duration, key times for VERIFY, warnings and the .aep path the build would write. Fix everything here before build_start.",
    input: z.object({
      project_id: uuidArg("project_id"),
      plan_version: z.number().int().min(1).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const plan = await loadSpec(ctx, project.data, input.plan_version);
      if (!plan.ok) return plan;
      const { missing, projectPath, compiled } = await dryCompile(
        ctx,
        project.data,
        plan.data.spec,
      );
      if (!compiled.ok && missing.length === 0) return compiled;
      return ok({
        ready: compiled.ok && missing.length === 0,
        plan_version: plan.data.version,
        missing,
        error: compiled.ok ? null : compiled.error,
        aep_path: projectPath,
        ...(compiled.ok
          ? {
              ops: compiled.data.ops.length,
              scenes: compiled.data.scenes,
              duration_s: compiled.data.duration,
              key_times: compiled.data.keyTimes,
              warnings: compiled.data.warnings,
              estimate_s: estimateSeconds(compiled.data.ops),
            }
          : {}),
      });
    },
  }),

  defineTool({
    name: "build_start",
    title: "Start build",
    description:
      "Starts a job that builds the plan in After Effects (CHECK → PLAN → INGEST → PREFLIGHT → BUILD → VERIFY …). Returns job_id immediately; poll job_status. dry_run=true only compiles and returns the op list summary and time estimate. One active job per device (JOB_ACTIVE).",
    input: z.object({
      project_id: uuidArg("project_id"),
      plan_version: z.number().int().min(1).optional(),
      dry_run: z.boolean().default(false),
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
      if (input.dry_run) {
        const plan = await loadSpec(ctx, project.data, input.plan_version);
        if (!plan.ok) return plan;
        const { missing, projectPath, compiled } = await dryCompile(
          ctx,
          project.data,
          plan.data.spec,
        );
        if (!compiled.ok) return compiled;
        const byOp = compiled.data.ops.reduce<Record<string, number>>((acc, op) => {
          acc[op.op] = (acc[op.op] ?? 0) + 1;
          return acc;
        }, {});
        const audioPlan = planAudioTasks(plan.data.spec, {
          videoDuration: compiled.data.duration,
          dictionaries: await dictionaries(ctx, ctx.userId),
        });
        const credits = audioPlan.length === 0 ? null : await estimateWithQuota(ctx, audioPlan);
        return ok({
          dry_run: true,
          plan_version: plan.data.version,
          missing,
          aep_path: projectPath,
          ops: compiled.data.ops.length,
          ops_by_type: byOp,
          scenes: compiled.data.scenes,
          duration_s: compiled.data.duration,
          estimate_s: estimateSeconds(compiled.data.ops),
          credits: credits?.total ?? 0,
          ...(credits === null ? {} : { audio: credits }),
          warnings: compiled.data.warnings,
        });
      }
      const created = await ctx.engine.create({
        projectId: project.data.id,
        ...(input.plan_version === undefined ? {} : { planVersion: input.plan_version }),
      });
      if (!created.ok) return created;
      return ok(await jobView(ctx, created.data, 5));
    },
  }),

  defineTool({
    name: "job_status",
    title: "Job status",
    description:
      "Job state, progress (done/total ops, %), current error, patch count, .aep path, last log lines and next_step advice. Poll every 5-10 s while the job runs.",
    input: z.object({
      job_id: uuidArg("job_id"),
      log_limit: z.number().int().min(0).max(100).default(15),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      return ok(await jobView(ctx, job.data, input.log_limit));
    },
  }),

  defineTool({
    name: "job_resume",
    title: "Resume job",
    description:
      "Continues a BLOCKED job from where it stopped (after the cause is fixed) or un-pauses a paused job. Already built parts are reused, nothing is duplicated.",
    input: jobArg,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      if (job.data.state === "WAITING_AGENT") {
        return fail("ENV_AGENT_OFFLINE", "Job panelni kutyapti: ulanishi bilan o'zi davom etadi");
      }
      const action = job.data.paused ? "resume" : "retry";
      const res = await ctx.engine.act(job.data.id, action);
      if (!res.ok) return res;
      return ok(await jobView(ctx, res.data, 5));
    },
  }),

  defineTool({
    name: "job_cancel",
    title: "Cancel job",
    description:
      "Cancels a job. Whatever was already built stays in the .aep (nothing is deleted); the job finishes with a report (outcome=cancelled).",
    input: jobArg,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      const res = await ctx.engine.act(job.data.id, "cancel");
      if (!res.ok) return res;
      return ok(await jobView(ctx, res.data, 5));
    },
  }),

  defineTool({
    name: "job_list",
    title: "List jobs",
    description: "Recent jobs (all projects or one project) with state and outcome.",
    input: z.object({
      project_id: uuidArg("project_id").optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const filters = [eq(projects.userId, ctx.userId)];
      if (input.project_id !== undefined) filters.push(eq(jobs.projectId, input.project_id));
      const rows = await ctx.app.db
        .select({ job: jobs, project: projects })
        .from(jobs)
        .innerJoin(projects, eq(projects.id, jobs.projectId))
        .where(and(...filters))
        .orderBy(desc(jobs.createdAt))
        .limit(input.limit);
      return ok(
        rows.map(({ job, project }) => ({
          id: job.id,
          project: { id: project.id, name: project.name },
          state: job.state,
          outcome: job.outcome,
          plan_version: job.planVersion,
          aep_path: job.aepVersion === null ? null : aepPath(project, job.aepVersion),
          created_at: job.createdAt,
        })),
      );
    },
  }),
];
