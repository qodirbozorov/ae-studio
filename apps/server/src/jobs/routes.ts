/**
 * Plan va job API (kabinet; Faza 3 dagi MCP toollari ham shu engine'ni chaqiradi).
 * Panel (qurilma tokeni) o'z aktiv job'ini boshqarishi uchun `/api/agent/jobs/*` (Live ekrani, P2.12).
 */
import { JOB_ACTIONS, fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { jobEvents, jobs, plans, projects, reports } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import type { JobEngine, JobRow } from "./engine";

const planSchema = z.strictObject({ spec: z.unknown() });
const createSchema = z.strictObject({ plan_version: z.number().int().min(1).optional() });
const actionSchema = z.strictObject({ action: z.enum(JOB_ACTIONS), spec: z.unknown().optional() });
const uuid = z.uuid();

export async function presentJob(engine: JobEngine, row: JobRow) {
  return {
    id: row.id,
    project_id: row.projectId,
    device_id: row.deviceId,
    plan_version: row.planVersion,
    state: row.state,
    prev_state: row.prevState,
    outcome: row.outcome,
    patch_count: row.patchCount,
    aep_version: row.aepVersion,
    paused: row.paused,
    error: row.error,
    progress: await engine.progress(row.id),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function status(result: Result<unknown>): number {
  if (result.ok) return 200;
  switch (result.error.code) {
    case "SYS_NOT_FOUND":
      return 404;
    case "JOB_ACTIVE":
    case "JOB_BAD_ACTION":
    case "LOOP_PATCH_LIMIT":
      return 409;
    default:
      return 400;
  }
}

export function registerJobRoutes(app: FastifyInstance, ctx: AppContext, engine: JobEngine): void {
  async function userProject(request: FastifyRequest) {
    const id = (request.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return null;
    const [row] = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, request.user!.id)))
      .limit(1);
    return row ?? null;
  }

  async function userJob(request: FastifyRequest): Promise<JobRow | null> {
    const id = (request.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return null;
    const [row] = await ctx.db
      .select({ job: jobs })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(and(eq(jobs.id, id), eq(projects.userId, request.user!.id)))
      .limit(1);
    return row?.job ?? null;
  }

  const notFound = (reply: FastifyReply, what: string) =>
    reply.code(404).send(fail("SYS_NOT_FOUND", `${what} topilmadi`));

  // ---------------------------------------------------------------- rejalar

  app.post("/api/projects/:id/plans", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null) return notFound(reply, "Loyiha");
    const body = planSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "spec kerak"));
    const result = await engine.addPlan(project.id, body.data.spec, "user");
    if (!result.ok) return reply.code(400).send(result);
    return ok({ version: result.data.version });
  });

  app.get("/api/projects/:id/plans", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null) return notFound(reply, "Loyiha");
    const rows = await ctx.db
      .select({ version: plans.version, created_by: plans.createdBy, created_at: plans.createdAt })
      .from(plans)
      .where(eq(plans.projectId, project.id))
      .orderBy(desc(plans.version));
    return ok(rows);
  });

  app.get(
    "/api/projects/:id/plans/:version",
    { preHandler: requireUser },
    async (request, reply) => {
      const project = await userProject(request);
      const version = Number((request.params as { version: string }).version);
      if (project === null || !Number.isInteger(version)) return notFound(reply, "Plan");
      const plan = await engine.plan(project.id, version);
      if (plan === null) return notFound(reply, "Plan");
      return ok({ version: plan.version, spec: plan.spec, created_by: plan.createdBy });
    },
  );

  // ---------------------------------------------------------------- joblar

  app.post("/api/projects/:id/jobs", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null) return notFound(reply, "Loyiha");
    const body = createSchema.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "plan_version noto'g'ri"));
    const result = await engine.create({
      projectId: project.id,
      ...(body.data.plan_version === undefined ? {} : { planVersion: body.data.plan_version }),
    });
    if (!result.ok) return reply.code(status(result)).send(result);
    return ok(await presentJob(engine, result.data));
  });

  app.get("/api/projects/:id/jobs", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null) return notFound(reply, "Loyiha");
    const rows = await ctx.db
      .select()
      .from(jobs)
      .where(eq(jobs.projectId, project.id))
      .orderBy(desc(jobs.createdAt))
      .limit(50);
    return ok(await Promise.all(rows.map((row) => presentJob(engine, row))));
  });

  app.get("/api/jobs/:id", { preHandler: requireUser }, async (request, reply) => {
    const job = await userJob(request);
    if (job === null) return notFound(reply, "Job");
    return ok(await presentJob(engine, job));
  });

  app.get("/api/jobs/:id/events", { preHandler: requireUser }, async (request, reply) => {
    const job = await userJob(request);
    if (job === null) return notFound(reply, "Job");
    const after = Number((request.query as { after?: string }).after ?? 0);
    const rows = await ctx.db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobId, job.id), gt(jobEvents.id, Number.isFinite(after) ? after : 0)))
      .orderBy(asc(jobEvents.id))
      .limit(500);
    return ok(
      rows.map((row) => ({
        id: row.id,
        ts: row.ts,
        level: row.level,
        type: row.type,
        op_id: row.opId,
        message: row.message,
        data: row.data,
      })),
    );
  });

  app.get("/api/jobs/:id/report", { preHandler: requireUser }, async (request, reply) => {
    const job = await userJob(request);
    if (job === null) return notFound(reply, "Job");
    const [row] = await ctx.db
      .select()
      .from(reports)
      .where(eq(reports.jobId, job.id))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    if (row === undefined) return notFound(reply, "Hisobot");
    return ok({ markdown: row.markdown, created_at: row.createdAt });
  });

  app.post("/api/jobs/:id/actions", { preHandler: requireUser }, async (request, reply) => {
    const job = await userJob(request);
    if (job === null) return notFound(reply, "Job");
    const body = actionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "action noto'g'ri"));
    const result = await engine.act(job.id, body.data.action, { spec: body.data.spec });
    if (!result.ok) return reply.code(status(result)).send(result);
    return ok(await presentJob(engine, result.data));
  });

  // ---------------------------------------------------------------- panel (qurilma tokeni)

  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  /** Panel ochilganda: shu qurilmadagi aktiv job (Live ekrani). */
  app.get("/api/agent/jobs/active", { preHandler: deviceAuth }, async (request) => {
    const job = await engine.activeJob(request.device!.deviceId);
    return ok(job === null ? null : await presentJob(engine, job));
  });

  /** Live ekranidagi tugmalar: faqat pause/resume/cancel. */
  app.post("/api/agent/jobs/:id/actions", { preHandler: deviceAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const job = uuid.safeParse(id).success ? await engine.get(id) : null;
    if (job === null || job.deviceId !== request.device!.deviceId) return notFound(reply, "Job");
    const body = z
      .strictObject({ action: z.enum(["pause", "resume", "cancel"]) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "action noto'g'ri"));
    const result = await engine.act(job.id, body.data.action);
    if (!result.ok) return reply.code(status(result)).send(result);
    return ok(await presentJob(engine, result.data));
  });
}
