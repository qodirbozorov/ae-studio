/**
 * Web kabinet sessiyasi: HttpOnly cookie'dagi opaque token → `oauth_tokens(kind=session)`.
 */
import { fail } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../context";
import { users } from "../db/schema";
import { findActiveToken } from "./tokens";

export const SESSION_COOKIE = "aes_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export function sessionCookieOptions(ctx: AppContext) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: ctx.env.PUBLIC_URL.startsWith("https://"),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

/** Cookie bo'lsa `request.user` ni to'ldiradi (yo'q bo'lsa null). */
export async function loadSession(ctx: AppContext, request: FastifyRequest): Promise<void> {
  request.user = null;
  const token = request.cookies[SESSION_COOKIE];
  if (token === undefined || token === "") return;
  const row = await findActiveToken(ctx.db, "session", token, ctx.now());
  if (row === null || row.userId === null) return;
  const [user] = await ctx.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (user !== undefined) request.user = { id: user.id, email: user.email, sessionId: row.id };
}

/** preHandler: sessiya bo'lmasa 401 AUTH_EXPIRED. */
export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.user === null) {
    await reply.code(401).send(fail("AUTH_EXPIRED", "Kirish talab qilinadi"));
  }
}
