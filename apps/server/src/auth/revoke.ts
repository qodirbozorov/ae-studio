/**
 * Foydalanuvchi tokenlarini bekor qilish va bloklash holati (P9.02, P9.06). Barcha kirish yo'llari
 * (kabinet sessiyasi, panel qurilma tokeni, Claude access/refresh) `oauth_tokens` orqali — bekor qilingan token
 * hech qayerda ishlamaydi. Bloklash qo'shimcha ravishda har autentifikatsiyada tekshiriladi.
 */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { devices, oauthTokens, users } from "../db/schema";
import type { TokenKind } from "./tokens";

/** Kirish tokenlari turlari (bir martalik kodlar emas). */
export const LOGIN_TOKEN_KINDS: TokenKind[] = ["session", "device", "access", "refresh"];

/** Foydalanuvchining faol tokenlarini bekor qiladi; bekor qilinganlar soni. */
export async function revokeUserTokens(
  db: Db,
  userId: string,
  kinds: TokenKind[],
  now: Date,
  options: { exceptId?: string } = {},
): Promise<number> {
  const where = [
    eq(oauthTokens.userId, userId),
    inArray(oauthTokens.kind, kinds),
    isNull(oauthTokens.revokedAt),
  ];
  if (options.exceptId !== undefined) where.push(ne(oauthTokens.id, options.exceptId));
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: now })
    .where(and(...where))
    .returning({ id: oauthTokens.id });
  return rows.length;
}

export async function isBlocked(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ blockedAt: users.blockedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.blockedAt != null;
}

/**
 * Bloklash: belgi + barcha kirish tokenlari bekor. Qaytaradi: uzilishi kerak bo'lgan qurilmalar
 * (chaqiruvchi hub orqali uzadi). Qurilma yozuvlari saqlanadi — blokdan chiqqach qayta ulanadi.
 */
export async function blockUser(
  db: Db,
  userId: string,
  reason: string | null,
  now: Date,
): Promise<{ revoked: number; deviceIds: string[] } | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ blockedAt: now, blockedReason: reason })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (user === undefined) return null;
    const revoked = await revokeUserTokens(tx, userId, LOGIN_TOKEN_KINDS, now);
    const owned = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(eq(devices.userId, userId));
    return { revoked, deviceIds: owned.map((row) => row.id) };
  });
}

export async function unblockUser(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ blockedAt: null, blockedReason: null })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  return rows.length > 0;
}
