/**
 * Opaque tokenlar (session, magic link, device ...): foydalanuvchiga tasodifiy satr beriladi,
 * DB'da (`oauth_tokens`) faqat sha256 hash saqlanadi. Bekor qilish — `revoked_at`.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthTokens } from "../db/schema";

export type TokenKind = (typeof oauthTokens.$inferInsert)["kind"];
export type TokenRow = typeof oauthTokens.$inferSelect;

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueToken(
  db: Db,
  input: {
    kind: TokenKind;
    ttlMs: number | null;
    now: Date;
    userId?: string | null;
    deviceId?: string | null;
    clientId?: string | null;
    scope?: string | null;
    data?: Record<string, unknown> | null;
    token?: string;
  },
): Promise<{ token: string; row: TokenRow }> {
  const token = input.token ?? newToken();
  const [row] = await db
    .insert(oauthTokens)
    .values({
      kind: input.kind,
      hash: hashToken(token),
      userId: input.userId ?? null,
      deviceId: input.deviceId ?? null,
      clientId: input.clientId ?? null,
      scope: input.scope ?? null,
      data: input.data ?? null,
      expiresAt: input.ttlMs === null ? null : new Date(input.now.getTime() + input.ttlMs),
    })
    .returning();
  return { token, row: row! };
}

/** Faol (bekor qilinmagan, muddati o'tmagan) tokenni topadi. */
export async function findActiveToken(
  db: Db,
  kind: TokenKind,
  token: string,
  now: Date,
): Promise<TokenRow | null> {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.hash, hashToken(token)),
        eq(oauthTokens.kind, kind),
        isNull(oauthTokens.revokedAt),
        or(isNull(oauthTokens.expiresAt), gt(oauthTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Tokenni bir martalik ishlatadi: faol bo'lsa atomar ravishda bekor qiladi va qaytaradi. */
export async function consumeToken(
  db: Db,
  kind: TokenKind,
  token: string,
  now: Date,
): Promise<TokenRow | null> {
  const [row] = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(oauthTokens.hash, hashToken(token)),
        eq(oauthTokens.kind, kind),
        isNull(oauthTokens.revokedAt),
        or(isNull(oauthTokens.expiresAt), gt(oauthTokens.expiresAt, now)),
      ),
    )
    .returning();
  return row ?? null;
}

export async function revokeToken(db: Db, id: string, now: Date): Promise<void> {
  await db.update(oauthTokens).set({ revokedAt: now }).where(eq(oauthTokens.id, id));
}
