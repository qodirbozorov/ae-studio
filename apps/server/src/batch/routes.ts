/**
 * Batch REST (P5.07): panel (qurilma tokeni) — Shablonlar ekranidan CSV bilan ishga tushirish va holat.
 */
import { ASPECTS, fail, ok, slugSchema } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { projects } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import { batchReport, presentBatch } from "./service";

export const batchStartSchema = z.object({
  project_id: z.uuid(),
  template: slugSchema,
  csv: z.string().min(1).max(1_000_000),
  mapping: z.record(z.string().min(1).max(100), z.string().regex(/^[a-z0-9_]{1,64}$/)).optional(),
  format: z.enum(ASPECTS).optional(),
  variants: z.array(z.enum(ASPECTS)).max(3).optional(),
  dur: z.number().positive().max(3600).optional(),
  brand: slugSchema.optional(),
});

export function registerBatchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  app.post("/api/agent/batches", { preHandler: deviceAuth }, async (request, reply) => {
    const body = batchStartSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", body.error.message));
    const device = request.device!;
    const [project] = await ctx.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, body.data.project_id), eq(projects.deviceId, device.deviceId)))
      .limit(1);
    if (project === undefined) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha bu qurilmada topilmadi"));
    }
    const started = await ctx.batches.start(device.userId, {
      projectId: project.id,
      template: body.data.template,
      csv: body.data.csv,
      mapping: body.data.mapping,
      format: body.data.format,
      variants: body.data.variants,
      dur: body.data.dur,
      brand: body.data.brand,
    });
    if (!started.ok) return reply.code(400).send(started);
    return ok(presentBatch(started.data));
  });

  app.get("/api/agent/batches/:id", { preHandler: deviceAuth }, async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    const batch = id.success ? await ctx.batches.get(request.device!.userId, id.data) : null;
    if (batch === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Batch topilmadi"));
    return ok({ ...presentBatch(batch), report: batchReport(batch) });
  });
}
