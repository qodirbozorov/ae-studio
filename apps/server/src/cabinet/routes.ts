/**
 * Web kabinet (P5.09, sessiya cookie): barcha loyihalar bo'yicha job tarixi, batch'lar, brand kit'lar.
 * Qurilmalar, ulangan ilovalar, ElevenLabs va Telegram — o'z modullarida.
 */
import { fail, ok } from "@aes/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit";
import { requireUser } from "../auth/session";
import { presentBatch } from "../batch/service";
import type { AppContext } from "../context";
import { batches, jobs, projects } from "../db/schema";
import type { JobEngine } from "../jobs/engine";
import { presentJob } from "../jobs/routes";

export function registerCabinetRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  engine: JobEngine,
): void {
  app.get("/api/jobs", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select({ job: jobs, project: projects })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(eq(projects.userId, request.user!.id))
      .orderBy(desc(jobs.createdAt))
      .limit(50);
    return ok(
      await Promise.all(
        rows.map(async ({ job, project }) => ({
          ...(await presentJob(engine, job)),
          project_name: project.name,
          batch_id: job.batchId,
          renders: (await engine.rendersOf(job.id)).map((render) => ({
            id: render.id,
            status: render.status,
            preset: render.preset,
            variant: render.variant,
            local_path: render.localPath,
          })),
        })),
      ),
    );
  });

  app.get("/api/batches", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(batches)
      .where(eq(batches.userId, request.user!.id))
      .orderBy(desc(batches.createdAt))
      .limit(30);
    return ok(rows.map((row) => presentBatch(row)));
  });

  app.get("/api/brands", { preHandler: requireUser }, async (request) =>
    ok(await ctx.brands.list(request.user!.id)),
  );

  app.put("/api/brands", { preHandler: requireUser }, async (request, reply) => {
    const saved = await ctx.brands.save(request.user!.id, request.body);
    if (!saved.ok) return reply.code(400).send(saved);
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "brand.saved",
      target: saved.data.slug,
      ip: request.ip,
    });
    return ok(saved.data);
  });

  app.delete("/api/brands/:slug", { preHandler: requireUser }, async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const removed = await ctx.brands.remove(request.user!.id, slug);
    if (!removed) return reply.code(404).send(fail("SYS_NOT_FOUND", "Brand topilmadi"));
    return ok({ removed: true });
  });
}
