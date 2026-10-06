/**
 * Kabinetga kirish Telegram orqali (email o'rniga):
 * 1) brauzer `POST /api/auth/telegram` → kod + deep link `t.me/<bot>?start=login_<kod>`; brauzerga httpOnly cookie
 *    siri beriladi (kodni boshqa brauzer ishlata olmaydi);
 * 2) foydalanuvchi botda Start bosadi → bot `/start login_<kod>` oladi → Telegram id bo'yicha hisob topiladi yoki
 *    yaratiladi, so'rov tasdiqlanadi; shu chat xabarnomalar uchun ham ulanadi;
 * 3) brauzer `GET /api/auth/telegram/status` ni so'raydi → tasdiqlangan bo'lsa sessiya cookie'si (bir martalik).
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppContext } from "../context";
import { telegramLinks, telegramLogins, users } from "../db/schema";
import { hashToken, newToken } from "./tokens";

export const TELEGRAM_LOGIN_TTL_MS = 10 * 60_000;
export const LOGIN_COOKIE = "aes_tg_login";
/** Deep link start parametri: `login_` + base64url (Telegram: A-Za-z0-9_-, ≤ 64). */
export const LOGIN_START_RE = /^\/start\s+login_([A-Za-z0-9_-]{16,48})\s*$/;

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

type Ctx = Pick<AppContext, "db" | "now">;

export async function startTelegramLogin(
  ctx: Ctx,
  next: string,
): Promise<{ code: string; secret: string; expiresAt: Date }> {
  const code = newToken(18);
  const secret = newToken();
  const expiresAt = new Date(ctx.now().getTime() + TELEGRAM_LOGIN_TTL_MS);
  await ctx.db
    .insert(telegramLogins)
    .values({ code, browserHash: hashToken(secret), next, expiresAt });
  return { code, secret, expiresAt };
}

function nameOf(user: TelegramUser): string {
  const full = [user.first_name, user.last_name]
    .filter((x) => x !== undefined && x !== "")
    .join(" ");
  if (full !== "") return user.username === undefined ? full : `${full} (@${user.username})`;
  return user.username === undefined ? `tg:${user.id}` : `@${user.username}`;
}

/** Telegram id bo'yicha hisob (bor bo'lsa ism yangilanadi). */
export async function findOrCreateTelegramUser(ctx: Ctx, tg: TelegramUser) {
  const telegramId = String(tg.id);
  const name = nameOf(tg);
  const [existing] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  if (existing !== undefined) {
    if (existing.name !== name) {
      await ctx.db.update(users).set({ name }).where(eq(users.id, existing.id));
    }
    return { ...existing, name };
  }
  const [created] = await ctx.db
    .insert(users)
    .values({ telegramId, name })
    .onConflictDoNothing()
    .returning();
  if (created !== undefined) return created;
  const [raced] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return raced!;
}

/**
 * Bot `/start login_<kod>` oldi: so'rovni tasdiqlaydi va chatni xabarnomalar uchun ulaydi.
 * Natija: `ok` | `expired` (kod yo'q, eskirgan yoki ishlatilgan).
 */
export async function confirmTelegramLogin(
  ctx: Ctx,
  code: string,
  tg: TelegramUser,
  chatId: string,
): Promise<"ok" | "expired"> {
  const [row] = await ctx.db
    .select()
    .from(telegramLogins)
    .where(
      and(
        eq(telegramLogins.code, code),
        gt(telegramLogins.expiresAt, ctx.now()),
        isNull(telegramLogins.confirmedAt),
      ),
    )
    .limit(1);
  if (row === undefined) return "expired";
  const user = await findOrCreateTelegramUser(ctx, tg);
  await ctx.db
    .update(telegramLogins)
    .set({ userId: user.id, confirmedAt: ctx.now() })
    .where(eq(telegramLogins.id, row.id));
  // Xabarnomalar shu chatga (kirish bilan birga avtomatik ulanadi).
  await ctx.db
    .insert(telegramLinks)
    .values({ userId: user.id, chatId, chatTitle: nameOf(tg), linkedAt: ctx.now() })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { chatId, chatTitle: nameOf(tg), linkedAt: ctx.now(), code: null, codeExpiresAt: null },
    });
  return "ok";
}

export type LoginPoll =
  { status: "pending" } | { status: "expired" } | { status: "ok"; userId: string; next: string };

/** Brauzer so'rovi: tasdiqlangan bo'lsa bir marta `ok` (keyin `expired`). */
export async function pollTelegramLogin(ctx: Ctx, secret: string): Promise<LoginPoll> {
  const [row] = await ctx.db
    .select()
    .from(telegramLogins)
    .where(eq(telegramLogins.browserHash, hashToken(secret)))
    .limit(1);
  if (row === undefined || row.consumedAt !== null) return { status: "expired" };
  if (row.confirmedAt === null || row.userId === null) {
    return row.expiresAt.getTime() <= ctx.now().getTime()
      ? { status: "expired" }
      : { status: "pending" };
  }
  const consumed = await ctx.db
    .update(telegramLogins)
    .set({ consumedAt: ctx.now() })
    .where(and(eq(telegramLogins.id, row.id), isNull(telegramLogins.consumedAt)))
    .returning({ id: telegramLogins.id });
  if (consumed.length === 0) return { status: "expired" };
  return { status: "ok", userId: row.userId, next: row.next };
}
