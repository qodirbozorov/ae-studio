/**
 * Kabinet → Sozlamalar → Telegram (P5.08): holat, bog'lash kodi, uzish.
 * Webhook (P9.06): Telegram `secret_token` sarlavhasi konstant vaqtda tekshiriladi.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { WEBHOOK_PATH } from "./service";
import type { TelegramUpdate } from "./service";

function sameSecret(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function registerTelegramRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(WEBHOOK_PATH, async (request, reply) => {
    const secret = ctx.telegram.webhookSecret;
    const header = request.headers["x-telegram-bot-api-secret-token"];
    if (secret === null || typeof header !== "string" || !sameSecret(header, secret)) {
      return reply.code(401).send(fail("AUTH_INVALID", "Webhook siri noto'g'ri"));
    }
    const update = request.body as TelegramUpdate | null;
    if (update === null || typeof update !== "object" || typeof update.update_id !== "number") {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "update"));
    }
    // Xato bo'lsa ham 200: Telegram qayta yuborib navbatni to'sib qo'ymasin (xato logda).
    try {
      await ctx.telegram.handleUpdate(update);
    } catch (error) {
      request.log.error({ err: error }, "telegram webhook xatosi");
    }
    return ok({ handled: true });
  });

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
