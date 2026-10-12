/**
 * Admin panel kirishi (`/admin`, Faza 9 P9.01 — storage uchun oldinroq): login va parol env'da
 * (`ADMIN_LOGIN`, `ADMIN_PASSWORD`). Sessiya — imzolangan cookie (HMAC, 12 soat); kalit parolga bog'liq,
 * shuning uchun parol almashtirilsa barcha admin sessiyalari bekor bo'ladi. Replikalar orasida holat yo'q.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { RateLimiter } from "../lib/rate-limit";

export const ADMIN_COOKIE = "aes_admin";
const TTL_MS = 12 * 60 * 60 * 1000;

type Ctx = Pick<AppContext, "env" | "db" | "now">;

function signingKey(env: Ctx["env"]): Buffer | null {
  if (env.ADMIN_LOGIN === undefined || env.ADMIN_PASSWORD === undefined) return null;
  return createHash("sha256")
    .update(
      `${env.MASTER_KEY ?? env.JWT_SIGNING_KEY ?? ""}\n${env.ADMIN_LOGIN}\n${env.ADMIN_PASSWORD}`,
    )
    .digest();
}

function sign(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function issueAdminToken(env: Ctx["env"], now: Date): string | null {
  const key = signingKey(env);
  if (key === null) return null;
  const payload = `${env.ADMIN_LOGIN}.${now.getTime() + TTL_MS}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(key, payload)}`;
}

export function verifyAdminToken(env: Ctx["env"], token: string, now: Date): boolean {
  const key = signingKey(env);
  if (key === null) return false;
  const [encoded, signature] = token.split(".");
  if (encoded === undefined || signature === undefined) return false;
  const payload = Buffer.from(encoded, "base64url").toString();
  if (!safeEqual(sign(key, payload), signature)) return false;
  const exp = Number(payload.slice(payload.lastIndexOf(".") + 1));
  return Number.isFinite(exp) && exp > now.getTime();
}

function cookieOptions(ctx: Ctx) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: ctx.env.PUBLIC_URL.startsWith("https://"),
    maxAge: Math.floor(TTL_MS / 1000),
  };
}

/** preHandler: admin cookie + (o'zgartiruvchi so'rovlarda) Origin tekshiruvi. */
export function makeRequireAdmin(ctx: Ctx) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[ADMIN_COOKIE];
    if (token === undefined || !verifyAdminToken(ctx.env, token, ctx.now())) {
      await reply.code(401).send(fail("AUTH_EXPIRED", "Admin kirishi talab qilinadi"));
      return;
    }
    const origin = request.headers.origin;
    if (request.method !== "GET" && origin !== undefined) {
      const expected = new URL(ctx.env.PUBLIC_URL).origin;
      if (origin !== expected) {
        await reply.code(403).send(fail("AUTH_INVALID", "Boshqa manbadan so'rov"));
      }
    }
  };
}

export function registerAdminAuth(app: FastifyInstance, ctx: Ctx): void {
  // IP bo'yicha: 15 daqiqada 8 ta urinish.
  const limiter = new RateLimiter(8, 15 * 60_000, () => ctx.now().getTime());
  const body = z.object({ login: z.string().max(200), password: z.string().max(500) });

  app.post("/api/admin/login", async (request, reply) => {
    if (signingKey(ctx.env) === null) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Admin panel sozlanmagan"));
    }
    if (!limiter.take(request.ip)) {
      return reply.code(429).send(
        fail("SYS_RATE_LIMIT", "Juda ko'p urinish", {
          retry_after_s: limiter.retryAfterS(request.ip),
        }),
      );
    }
    const parsed = body.safeParse(request.body);
    const valid =
      parsed.success &&
      safeEqual(parsed.data.login, ctx.env.ADMIN_LOGIN!) &&
      safeEqual(parsed.data.password, ctx.env.ADMIN_PASSWORD!);
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: valid ? "admin.login" : "admin.login_failed",
      ip: request.ip,
    });
    if (!valid) return reply.code(401).send(fail("AUTH_INVALID", "Login yoki parol noto'g'ri"));
    reply.setCookie(ADMIN_COOKIE, issueAdminToken(ctx.env, ctx.now())!, cookieOptions(ctx));
    return ok({ login: ctx.env.ADMIN_LOGIN });
  });

  const requireAdmin = makeRequireAdmin(ctx);
  app.get("/api/admin/me", { preHandler: requireAdmin }, async () =>
    ok({ login: ctx.env.ADMIN_LOGIN }),
  );
  app.post("/api/admin/logout", async (request, reply) => {
    const token = request.cookies[ADMIN_COOKIE];
    if (token !== undefined && verifyAdminToken(ctx.env, token, ctx.now())) {
      await audit(ctx, request.log, {
        userId: null,
        actor: "admin",
        action: "admin.logout",
        ip: request.ip,
      });
    }
    reply.clearCookie(ADMIN_COOKIE, { path: "/" });
    return ok({ logged_out: true });
  });
}
