/** Kabinet → Sozlamalar → Telegram (P5.08): holat, bog'lash kodi, uzish. */
import { ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";

export function registerTelegramRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/settings/telegram", { preHandler: requireUser }, async (request) =>
    ok(await ctx.telegram.status(request.user!.id)),
  );

  app.post("/api/settings/telegram/code", { preHandler: requireUser }, async (request, reply) => {
    const code = await ctx.telegram.createCode(request.user!.id);
    if (!code.ok) return reply.code(400).send(code);
    return code;
  });

  app.delete("/api/settings/telegram", { preHandler: requireUser }, async (request) => {
    await ctx.telegram.unlink(request.user!.id);
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "telegram.unlinked",
      ip: request.ip,
    });
    return ok({ removed: true });
  });
}
