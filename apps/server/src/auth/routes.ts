/**
 * Web kabinet login (§4.3): Telegram bot deep link orqali (email yo'q). Batafsil — `telegram-login.ts`.
 * Sessiyalar (P9.06): IP va brauzer bilan saqlanadi, ro'yxat, bittasini yoki boshqa barchasini bekor qilish,
 * kuniga bir marta rotatsiya (eski token qisqa muddat ishlaydi — parallel so'rovlar uzilmasin).
 */
import { fail, ok } from "@aes/shared";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { devices, oauthTokens, users } from "../db/schema";
import { clipAgent, describeAgent } from "./client-info";
import { isBlocked, revokeUserTokens } from "./revoke";
import { SESSION_COOKIE, SESSION_TTL_MS, requireUser, sessionCookieOptions } from "./session";
import {
  LOGIN_COOKIE,
  TELEGRAM_LOGIN_TTL_MS,
  pollTelegramLogin,
  startTelegramLogin,
} from "./telegram-login";
import { issueToken, revokeToken } from "./tokens";

/** Sessiya shu yoshdan katta bo'lsa `/api/me` da yangisiga almashtiriladi. */
export const SESSION_ROTATE_MS = 24 * 3600_000;
/** Rotatsiyadan keyin eski token yana shuncha ishlaydi (bir vaqtdagi so'rovlar uchun). */
const ROTATE_GRACE_MS = 60_000;

const sessionMeta = (request: FastifyRequest) => ({
  ip: request.ip,
  ua: clipAgent(request.headers["user-agent"]),
});

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
    const login = await startTelegramLogin(ctx, parsed.data.next ?? "/", {
      ip: request.ip,
      userAgent: clipAgent(request.headers["user-agent"]),
    });
    reply.setCookie(LOGIN_COOKIE, login.secret, cookieOptions());
    return ok({
      link: `https://t.me/${bot}?start=login_${login.code}`,
      bot,
      /** Botda shu raqam tanlanadi (P9.06). */
      match_code: login.matchCode,
      expires_at: login.expiresAt.toISOString(),
      poll_ms: 2000,
    });
  });

  /** Brauzer so'rovi: bot tasdiqlagan bo'lsa sessiya beriladi (bir martalik). */
  app.get("/api/auth/telegram/status", async (request, reply) => {
    const secret = request.cookies[LOGIN_COOKIE];
    if (secret === undefined || secret === "") return ok({ status: "expired" });
    const result = await pollTelegramLogin(ctx, secret);
    if (result.status === "rejected") {
      reply.clearCookie(LOGIN_COOKIE, { path: "/" });
      return ok({ status: "rejected", reason: result.reason });
    }
    if (result.status !== "ok") return ok({ status: result.status });
    reply.clearCookie(LOGIN_COOKIE, { path: "/" });
    if (await isBlocked(ctx.db, result.userId))
      return ok({ status: "rejected", reason: "blocked" });
    const session = await issueToken(ctx.db, {
      kind: "session",
      ttlMs: SESSION_TTL_MS,
      now: ctx.now(),
      userId: result.userId,
      data: sessionMeta(request),
    });
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(ctx));
    await audit(ctx, request.log, {
      userId: result.userId,
      actor: "user",
      action: "auth.login",
      ip: request.ip,
      data: { browser: describeAgent(request.headers["user-agent"]) },
    });
    return ok({ status: "ok", next: result.next });
  });

  /** Kuniga bir marta sessiya tokeni yangilanadi (o'g'irlangan eski cookie uzoq yashamasin). */
  const rotate = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (ctx.now().getTime() - user.sessionCreatedAt.getTime() < SESSION_ROTATE_MS) return;
    const now = ctx.now();
    const old = await ctx.db
      .update(oauthTokens)
      .set({ expiresAt: new Date(now.getTime() + ROTATE_GRACE_MS) })
      .where(
        and(
          eq(oauthTokens.id, user.sessionId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, new Date(now.getTime() + ROTATE_GRACE_MS)),
        ),
      )
      .returning({ id: oauthTokens.id });
    // Parallel so'rov allaqachon almashtirgan — ikkinchi yangi sessiya yaratilmaydi.
    if (old.length === 0) return;
    const fresh = await issueToken(ctx.db, {
      kind: "session",
      ttlMs: SESSION_TTL_MS,
      now,
      userId: user.id,
      data: sessionMeta(request),
    });
    reply.setCookie(SESSION_COOKIE, fresh.token, sessionCookieOptions(ctx));
  };

  app.get("/api/me", { preHandler: requireUser }, async (request, reply) => {
    await rotate(request, reply);
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

  /** Faol kabinet sessiyalari (qaysi brauzer va IP'dan). */
  app.get("/api/me/sessions", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.userId, request.user!.id),
          eq(oauthTokens.kind, "session"),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, ctx.now()),
        ),
      )
      .orderBy(desc(oauthTokens.createdAt))
      .limit(50);
    return ok({
      sessions: rows.map((row) => ({
        id: row.id,
        created_at: row.createdAt,
        ip: typeof row.data?.ip === "string" ? row.data.ip : null,
        browser: describeAgent(typeof row.data?.ua === "string" ? row.data.ua : null),
        current: row.id === request.user!.sessionId,
      })),
    });
  });

  app.delete("/api/me/sessions/:id", { preHandler: requireUser }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const rows = await ctx.db
      .update(oauthTokens)
      .set({ revokedAt: ctx.now() })
      .where(
        and(
          eq(oauthTokens.id, id),
          eq(oauthTokens.userId, request.user!.id),
          eq(oauthTokens.kind, "session"),
          isNull(oauthTokens.revokedAt),
        ),
      )
      .returning({ id: oauthTokens.id });
    if (rows.length === 0) return reply.code(404).send(fail("SYS_NOT_FOUND", "Sessiya topilmadi"));
    if (id === request.user!.sessionId) reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return ok({ revoked: true });
  });

  /** Boshqa barcha brauzerlardan chiqish (joriy sessiya qoladi). */
  app.post("/api/auth/logout-all", { preHandler: requireUser }, async (request) => {
    const revoked = await revokeUserTokens(ctx.db, request.user!.id, ["session"], ctx.now(), {
      exceptId: request.user!.sessionId,
    });
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "auth.logout_all",
      ip: request.ip,
      data: { revoked },
    });
    return ok({ revoked });
  });
}
