/** Loyiha va plan toollari (§8): project_create/list/get, plan_write/patch/get. */
import { randomUUID } from "node:crypto";
import { collectAssetRefs, fail, ok, parseSpec } from "@aes/shared";
import type { VideoSpec } from "@aes/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assets, devices, jobs, plans, projects } from "../../db/schema";
import { applyJsonPatch, jsonPatchSchema } from "../../lib/json-patch";
import { normalizeRootPath } from "../../projects/routes";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { ownProject, pickDevice, uuidArg } from "./common";
import type { ProjectRow } from "./common";

const PROJECT_OPEN_TIMEOUT_MS = 30_000;

function specSummary(spec: VideoSpec) {
  const numeric = spec.scenes.map((scene) => (typeof scene.dur === "number" ? scene.dur : null));
  return {
    format: spec.format,
    output: spec.output,
    scenes: spec.scenes.map((scene) => ({
      id: scene.id,
      dur: scene.dur,
      layers: scene.layers?.length ?? 0,
    })),
    duration_s: numeric.every((d) => d !== null)
      ? Math.round(numeric.reduce((a, b) => a + b!, 0)! * 1000) / 1000
      : null,
    asset_refs: collectAssetRefs(spec),
  };
}

async function projectOverview(ctx: ToolContext, project: ProjectRow) {
  const [device] =
    project.deviceId === null
      ? []
      : await ctx.app.db.select().from(devices).where(eq(devices.id, project.deviceId)).limit(1);
  const [lastPlan] = await ctx.app.db
    .select({ version: plans.version })
    .from(plans)
    .where(eq(plans.projectId, project.id))
    .orderBy(desc(plans.version))
    .limit(1);
  const [lastJob] = await ctx.app.db
    .select()
    .from(jobs)
    .where(eq(jobs.projectId, project.id))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return {
    id: project.id,
    name: project.name,
    root_path: project.rootPath,
    device:
      device === undefined
        ? null
        : { id: device.id, name: device.name, online: ctx.app.hub.isOnline(device.id) },
    latest_plan_version: lastPlan?.version ?? null,
    latest_job:
      lastJob === undefined
        ? null
        : {
            id: lastJob.id,
            state: lastJob.state,
            outcome: lastJob.outcome,
            aep_version: lastJob.aepVersion,
          },
    created_at: project.createdAt,
  };
}

const specArg = z.record(z.string(), z.unknown()).describe("Video Spec object (see spec_schema)");

export const projectTools = [
  defineTool({
    name: "project_create",
    title: "Create / open project",
    description:
      "Opens an existing folder on the user's machine as a project through the AE panel: creates source/ audio/ frames/ out/ logs/ subfolders inside it, registers the project and makes it the panel's active folder. root_path must be absolute and must already exist (e.g. D:/Videos/reel); ask the user for it.",
    input: z.object({
      root_path: z
        .string()
        .min(2)
        .max(1024)
        .describe("Absolute folder path on the user's computer"),
      device_id: uuidArg("device_id").optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      if (normalizeRootPath(input.root_path) === null) {
        return fail(
          "ENV_NO_FOLDER",
          "root_path absolyut yo'l bo'lishi kerak (masalan D:/Videos/reel)",
        );
      }
      const device = await pickDevice(ctx, input.device_id);
      if (!device.ok) return device;
      const reply = await ctx.app.hub.request(
        device.data.id,
        { type: "project.open", request_id: randomUUID(), root_path: input.root_path },
        PROJECT_OPEN_TIMEOUT_MS,
      );
      if (!reply.ok) return reply;
      if (reply.data.type !== "project.opened") return fail("SYS_INTERNAL", "Kutilmagan javob");
      const project = await ownProject(ctx, reply.data.project.id);
      if (!project.ok) return project;
      return ok(await projectOverview(ctx, project.data));
    },
  }),

  defineTool({
    name: "project_list",
    title: "List projects",
    description:
      "Lists the user's projects (folders) with device status, latest plan version and latest job.",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx) {
      const rows = await ctx.app.db
        .select()
        .from(projects)
        .where(eq(projects.userId, ctx.userId))
        .orderBy(desc(projects.createdAt))
        .limit(50);
      return ok(await Promise.all(rows.map((row) => projectOverview(ctx, row))));
    },
  }),

  defineTool({
    name: "project_get",
    title: "Project details",
    description:
      "Project details: assets summary (by kind and status), plan versions, recent jobs and the active job.",
    input: z.object({ project_id: uuidArg("project_id") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const assetRows = await ctx.app.db
        .select({ kind: assets.kind, status: assets.status })
        .from(assets)
        .where(eq(assets.projectId, project.data.id));
      const count = (key: "kind" | "status") =>
        assetRows.reduce<Record<string, number>>((acc, row) => {
          acc[row[key]] = (acc[row[key]] ?? 0) + 1;
          return acc;
        }, {});
      const planRows = await ctx.app.db
        .select({
          version: plans.version,
          created_by: plans.createdBy,
          created_at: plans.createdAt,
        })
        .from(plans)
        .where(eq(plans.projectId, project.data.id))
        .orderBy(desc(plans.version))
        .limit(20);
      const jobRows = await ctx.app.db
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, project.data.id))
        .orderBy(desc(jobs.createdAt))
        .limit(5);
      return ok({
        ...(await projectOverview(ctx, project.data)),
        assets: { total: assetRows.length, by_kind: count("kind"), by_status: count("status") },
        plans: planRows,
        jobs: jobRows.map((job) => ({
          id: job.id,
          state: job.state,
          outcome: job.outcome,
          plan_version: job.planVersion,
          aep_version: job.aepVersion,
          created_at: job.createdAt,
        })),
      });
    },
  }),

  defineTool({
    name: "plan_write",
    title: "Write plan",
    description:
      "Saves a new Video Spec version for the project (never overwrites; returns version). Validated strictly: SPEC_INVALID errors list exact JSON Pointer paths in error.details. Media must be asset:<key> from assets_list.",
    input: z.object({ project_id: uuidArg("project_id"), spec: specArg }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const saved = await ctx.engine.addPlan(project.data.id, input.spec, "claude");
      if (!saved.ok) return saved;
      return ok({ version: saved.data.version, ...specSummary(saved.data.spec) });
    },
  }),

  defineTool({
    name: "plan_patch",
    title: "Patch plan",
    description:
      'Applies an RFC 6902 JSON Patch to a plan version (default: latest) and saves the result as a new version. Example: [{"op":"replace","path":"/scenes/1/dur","value":3}].',
    input: z.object({
      project_id: uuidArg("project_id"),
      patch: jsonPatchSchema,
      base_version: z.number().int().min(1).optional(),
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
      const base = await ctx.engine.plan(project.data.id, input.base_version);
      if (base === null) return fail("SYS_NOT_FOUND", "Plan topilmadi (plan_write)");
      const patched = applyJsonPatch(base.spec, input.patch);
      if (!patched.ok) return patched;
      const saved = await ctx.engine.addPlan(project.data.id, patched.data, "claude");
      if (!saved.ok) return saved;
      return ok({
        version: saved.data.version,
        base_version: base.version,
        ...specSummary(saved.data.spec),
      });
    },
  }),

  defineTool({
    name: "plan_get",
    title: "Get plan",
    description:
      "Returns a plan version (default latest) with its spec, plus the list of all versions.",
    input: z.object({
      project_id: uuidArg("project_id"),
      version: z.number().int().min(1).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const plan = await ctx.engine.plan(project.data.id, input.version);
      if (plan === null) return fail("SYS_NOT_FOUND", "Plan topilmadi");
      const versions = await ctx.app.db
        .select({
          version: plans.version,
          created_by: plans.createdBy,
          created_at: plans.createdAt,
        })
        .from(plans)
        .where(and(eq(plans.projectId, project.data.id)))
        .orderBy(desc(plans.version));
      const parsed = parseSpec(plan.spec);
      return ok({
        version: plan.version,
        created_by: plan.createdBy,
        spec: plan.spec,
        summary: parsed.ok ? specSummary(parsed.data) : null,
        versions,
      });
    },
  }),
];
