/**
 * Web kabinet login (§4.3): Telegram bot deep link orqali (email yo'q). Batafsil — `telegram-login.ts`.
 */
import { fail, ok } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { devices, users } from "../db/schema";
import { SESSION_COOKIE, SESSION_TTL_MS, requireUser, sessionCookieOptions } from "./session";
import {
  LOGIN_COOKIE,
  TELEGRAM_LOGIN_TTL_MS,
  pollTelegramLogin,
  startTelegramLogin,
} from "./telegram-login";
import { issueToken, revokeToken } from "./tokens";

const startSchema = z.strictObject({
  /** Kirgandan keyin qaytiladigan kabinet ichki yo'li (masalan `/device?code=ABC123`). */
  next: z
    .string()
    .regex(/^\/[^/\\]/)
    .max(4000)
    .optional(),
});

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const cookieOptions = () => ({
    ...sessionCookieOptions(ctx),
    maxAge: Math.floor(TELEGRAM_LOGIN_TTL_MS / 1000),
  });

  /** Kirishni boshlash: bot deep link'i va brauzer siri (cookie). */
  app.post("/api/auth/telegram", async (request, reply) => {
    const bot = ctx.env.TELEGRAM_BOT_USERNAME;
    if (ctx.env.TELEGRAM_BOT_TOKEN === undefined || bot === undefined) {
      return reply
        .code(503)
        .send(
          fail(
            "SYS_INTERNAL",
            "Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME)",
          ),
        );
    }
    const parsed = startSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "next noto'g'ri"));
    const login = await startTelegramLogin(ctx, parsed.data.next ?? "/");
    reply.setCookie(LOGIN_COOKIE, login.secret, cookieOptions());
    return ok({
      link: `https://t.me/${bot}?start=login_${login.code}`,
      bot,
      expires_at: login.expiresAt.toISOString(),
      poll_ms: 2000,
    });
  });

  /** Brauzer so'rovi: bot tasdiqlagan bo'lsa sessiya beriladi (bir martalik). */
  app.get("/api/auth/telegram/status", async (request, reply) => {
    const secret = request.cookies[LOGIN_COOKIE];
    if (secret === undefined || secret === "") return ok({ status: "expired" });
    const result = await pollTelegramLogin(ctx, secret);
    if (result.status !== "ok") return ok({ status: result.status });
    const session = await issueToken(ctx.db, {
      kind: "session",
      ttlMs: SESSION_TTL_MS,
      now: ctx.now(),
      userId: result.userId,
    });
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(ctx));
    reply.clearCookie(LOGIN_COOKIE, { path: "/" });
    return ok({ status: "ok", next: result.next });
  });

  app.get("/api/me", { preHandler: requireUser }, async (request) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, request.user!.id));
    const owned = await ctx.db
      .select({ id: devices.id, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.userId, request.user!.id));
    return ok({
      id: request.user!.id,
      name: request.user!.name,
      telegram_id: user?.telegramId ?? null,
      email: user?.email ?? null,
      created_at: user?.createdAt ?? null,
      devices: owned.filter((d) => d.revokedAt === null).length,
      online: owned.filter((d) => d.revokedAt === null && ctx.hub.isOnline(d.id)).length,
    });
  });

  app.post("/api/auth/logout", { preHandler: requireUser }, async (request, reply) => {
    await revokeToken(ctx.db, request.user!.sessionId, ctx.now());
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return ok({ logged_out: true });
  });
}
