/**
 * `/ws/agent` (device token bilan) va qurilmaga to'g'ridan-to'g'ri op yuborish
 * (`POST /api/devices/:id/ops`, faqat egasi; P2.11 dagi job'largacha sinov va diagnostika uchun).
 */
import { fail, parseOpEnvelope } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { devices } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import type { DeviceIdentity } from "../devices/routes";
import type { AgentHub } from "./hub";

declare module "fastify" {
  interface FastifyRequest {
    device: DeviceIdentity | null;
  }
}

export function registerAgentSocket(app: FastifyInstance, ctx: AppContext, hub: AgentHub): void {
  app.decorateRequest("device", null);

  const authDevice = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  app.get("/ws/agent", { websocket: true, preValidation: authDevice }, (socket, request) => {
    hub.attach(socket, request.device!);
  });

  app.post("/api/devices/:id/ops", { preHandler: requireUser }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const [device] = await ctx.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.userId, request.user!.id)))
      .limit(1);
    if (device === undefined || device.revokedAt !== null) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Qurilma topilmadi"));
    }
    const parsed = parseOpEnvelope(request.body);
    if (!parsed.ok) return reply.code(400).send(parsed);
    const result = await hub.run(id, parsed.data, "direct");
    if (!result.ok && result.error.code === "ENV_AGENT_OFFLINE") reply.code(503);
    return result;
  });
}
