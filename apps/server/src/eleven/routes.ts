/**
 * Kabinet → Sozlamalar → ElevenLabs (P4.01): kalitni kiritish (tekshirib, shifrlab saqlanadi), holat, o'chirish.
 * Kalit hech qachon qaytarilmaydi — faqat `…abcd`.
 */
import { fail, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";

const keySchema = z.strictObject({ api_key: z.string().trim().min(10).max(200) });

export function registerElevenRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/settings/elevenlabs", { preHandler: requireUser }, async (request) =>
    ok(await ctx.eleven.account(request.user!.id)),
  );

  app.put("/api/settings/elevenlabs", { preHandler: requireUser }, async (request, reply) => {
    const parsed = keySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "api_key kerak"));
    const result = await ctx.eleven.setKey(request.user!.id, parsed.data.api_key);
    if (!result.ok) return reply.code(400).send(result);
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "elevenlabs.key_set",
      target: result.data.masked,
      ip: request.ip,
    });
    return result;
  });

  app.delete("/api/settings/elevenlabs", { preHandler: requireUser }, async (request) => {
    await ctx.eleven.removeKey(request.user!.id);
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "elevenlabs.key_removed",
      ip: request.ip,
    });
    return ok({ removed: true });
  });
}
