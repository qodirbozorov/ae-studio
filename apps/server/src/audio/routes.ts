/**
 * Panel Audio ekrani (P4.12, qurilma tokeni): loyiha audio vazifalari, qayta generatsiya, qayta urinish.
 * Jonli yangilanishlar WS `audio.update` orqali.
 */
import { fail, ok } from "@aes/shared";
import type { AudioKind } from "@aes/shared";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { audioTasks, projects } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import { presentTask } from "./service";
import type { AudioTaskRow } from "./service";

export function registerAudioRoutes(app: FastifyInstance, ctx: AppContext): void {
  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  /** Faqat shu qurilma loyihalaridagi vazifa. */
  async function deviceTask(request: FastifyRequest): Promise<AudioTaskRow | null> {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await ctx.db
      .select({ task: audioTasks })
      .from(audioTasks)
      .innerJoin(projects, eq(projects.id, audioTasks.projectId))
      .where(and(eq(audioTasks.id, id), eq(projects.deviceId, request.device!.deviceId)))
      .limit(1);
    return row?.task ?? null;
  }

  app.get("/api/agent/audio", { preHandler: deviceAuth }, async (request) => {
    const projectId = (request.query as { project_id?: string }).project_id;
    const where = [eq(projects.deviceId, request.device!.deviceId)];
    if (projectId !== undefined && z.uuid().safeParse(projectId).success) {
      where.push(eq(audioTasks.projectId, projectId));
    }
    const rows = await ctx.db
      .select({ task: audioTasks })
      .from(audioTasks)
      .innerJoin(projects, eq(projects.id, audioTasks.projectId))
      .where(and(...where))
      .orderBy(desc(audioTasks.createdAt))
      .limit(100);
    return ok(rows.map(({ task }) => presentTask(task)));
  });

  /** Qayta generatsiya: o'sha parametrlar, kesh chetlab o'tiladi (yangi variant, eski fayl qoladi). */
  app.post(
    "/api/agent/audio/:id/regenerate",
    { preHandler: deviceAuth },
    async (request, reply) => {
      const task = await deviceTask(request);
      if (task === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Audio topilmadi"));
      const result = await ctx.audio.submit({
        userId: task.userId,
        projectId: task.projectId,
        jobId: task.jobId,
        kind: task.kind as AudioKind,
        label: task.label,
        params: task.params as Record<string, unknown>,
        inputs: task.inputs ?? [],
        fresh: true,
      });
      if (!result.ok) return reply.code(400).send(result);
      return ok(presentTask(result.data));
    },
  );

  app.post("/api/agent/audio/:id/retry", { preHandler: deviceAuth }, async (request, reply) => {
    const task = await deviceTask(request);
    if (task === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Audio topilmadi"));
    const result = await ctx.audio.retry(task.id);
    if (!result.ok) return reply.code(409).send(result);
    return ok(presentTask(result.data));
  });
}
