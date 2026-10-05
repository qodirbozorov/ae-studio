/**
 * Web kabinet login (§4.3): email magic link (Q2). Havola 15 daqiqa amal qiladi va bir martalik.
 */
import { fail, ok } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { users } from "../db/schema";
import { SESSION_COOKIE, SESSION_TTL_MS, requireUser, sessionCookieOptions } from "./session";
import { consumeToken, issueToken, revokeToken } from "./tokens";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Bir email'ga qayta havola yuborish oralig'i. */
const RESEND_INTERVAL_MS = 30_000;

const emailSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  /** Kirgandan keyin qaytiladigan kabinet ichki yo'li (masalan `/device?code=ABC123`). */
  next: z
    .string()
    .regex(/^\/[^/\\]/)
    .max(500)
    .optional(),
});

function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/[^/\\]/.test(next) ? next : "/";
}

export async function findOrCreateUser(ctx: AppContext, email: string) {
  const normalized = email.trim().toLowerCase();
  const [existing] = await ctx.db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (existing !== undefined) return existing;
  const [created] = await ctx.db
    .insert(users)
    .values({ email: normalized })
    .onConflictDoNothing()
    .returning();
  if (created !== undefined) return created;
  const [raced] = await ctx.db.select().from(users).where(eq(users.email, normalized)).limit(1);
  return raced!;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const lastSent = new Map<string, number>();

  app.post("/api/auth/magic-link", async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "Email noto'g'ri"));
    const email = parsed.data.email;
    const nowMs = ctx.now().getTime();
    const previous = lastSent.get(email);
    if (previous !== undefined && nowMs - previous < RESEND_INTERVAL_MS) {
      return reply
        .code(429)
        .send(fail("SYS_RATE_LIMIT", "Havola yaqinda yuborilgan, biroz kuting"));
    }
    lastSent.set(email, nowMs);

    const { token } = await issueToken(ctx.db, {
      kind: "magic_link",
      ttlMs: MAGIC_LINK_TTL_MS,
      now: ctx.now(),
      data: { email, next: parsed.data.next ?? "/" },
    });
    const link = `${ctx.env.PUBLIC_URL}/api/auth/verify?token=${encodeURIComponent(token)}`;
    await ctx.mailer.send({
      to: email,
      subject: "AE Studio — kirish havolasi",
      text: `AE Studio kabinetiga kirish uchun havola (15 daqiqa amal qiladi):\n${link}\n\nSiz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring.`,
      html: `<p>AE Studio kabinetiga kirish uchun havola (15 daqiqa amal qiladi):</p><p><a href="${link}">Kirish</a></p><p>Siz so'ramagan bo'lsangiz, bu xatni e'tiborsiz qoldiring.</p>`,
    });
    // Email mavjudligini oshkor qilmaslik uchun javob har doim bir xil.
    return ok({ sent: true });
  });

  app.get("/api/auth/verify", async (request, reply) => {
    const token = (request.query as { token?: unknown }).token;
    if (typeof token !== "string" || token === "") {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "token yo'q"));
    }
    const row = await consumeToken(ctx.db, "magic_link", token, ctx.now());
    const email = row?.data?.email;
    if (row === null || typeof email !== "string") {
      return reply.code(401).send(fail("AUTH_EXPIRED", "Havola eskirgan yoki ishlatilgan"));
    }
    const user = await findOrCreateUser(ctx, email);
    const session = await issueToken(ctx.db, {
      kind: "session",
      ttlMs: SESSION_TTL_MS,
      now: ctx.now(),
      userId: user.id,
    });
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(ctx));
    return reply.redirect(safeNext(row.data?.next), 303);
  });

  app.get("/api/me", { preHandler: requireUser }, async (request) =>
    ok({ id: request.user!.id, email: request.user!.email }),
  );

  app.post("/api/auth/logout", { preHandler: requireUser }, async (request, reply) => {
    await revokeToken(ctx.db, request.user!.sessionId, ctx.now());
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return ok({ logged_out: true });
  });
}
