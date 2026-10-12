/**
 * Kabinetga kirish Telegram orqali (email o'rniga):
 * 1) brauzer `POST /api/auth/telegram` → kod + deep link `t.me/<bot>?start=login_<kod>` va saytda ko'rinadigan
 *    2 xonali raqam; brauzerga httpOnly cookie siri beriladi (kodni boshqa brauzer ishlata olmaydi);
 * 2) foydalanuvchi botda Start bosadi → bot so'rov tafsilotini (brauzer, IP, vaqt) va 3 ta raqam tugmasini
 *    yuboradi + «Bu men emas» (P9.06);
 * 3) saytdagi raqam bosilsa — Telegram id bo'yicha hisob topiladi yoki yaratiladi, so'rov tasdiqlanadi, shu chat
 *    xabarnomalar uchun ulanadi. Noto'g'ri raqam yoki «Bu men emas» — so'rov bekor (qayta urinib bo'lmaydi);
 * 4) brauzer `GET /api/auth/telegram/status` ni so'raydi → tasdiqlangan bo'lsa sessiya cookie'si (bir martalik).
 *
 * Fishing himoyasi: begona odam o'z brauzerida kirishni boshlab havolani qurbonga yuborsa, qurbon botda so'rov
 * tafsilotini (boshqa IP/brauzer) ko'radi va saytdagi raqamni bilmaydi — tasdiq bo'lmaydi.
 */
import { randomInt } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppContext } from "../context";
import { telegramLinks, telegramLogins, users } from "../db/schema";
import { hashToken, newToken } from "./tokens";

export const TELEGRAM_LOGIN_TTL_MS = 10 * 60_000;
export const LOGIN_COOKIE = "aes_tg_login";
/** Deep link start parametri: `login_` + base64url (Telegram: A-Za-z0-9_-, ≤ 64). */
export const LOGIN_START_RE = /^\/start\s+login_([A-Za-z0-9_-]{16,48})\s*$/;
/** Tugma ma'lumoti: `lg:<so'rov id>:<raqam | x>` (Telegram: ≤ 64 bayt). */
export const LOGIN_CALLBACK_RE = /^lg:([0-9a-f-]{36}):(\d{2}|x)$/;

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

type Ctx = Pick<AppContext, "db" | "now">;
type LoginRow = typeof telegramLogins.$inferSelect;

export function newMatchCode(): string {
  return String(randomInt(10, 100));
}

/** To'g'ri raqam + 2 ta boshqa, aralashtirilgan. */
export function matchChoices(code: string): string[] {
  const set = new Set([code]);
  while (set.size < 3) set.add(newMatchCode());
  const list = [...set];
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

export async function startTelegramLogin(
  ctx: Ctx,
  next: string,
  meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): Promise<{ code: string; secret: string; expiresAt: Date; matchCode: string }> {
  const code = newToken(18);
  const secret = newToken();
  const matchCode = newMatchCode();
  const expiresAt = new Date(ctx.now().getTime() + TELEGRAM_LOGIN_TTL_MS);
  await ctx.db.insert(telegramLogins).values({
    code,
    browserHash: hashToken(secret),
    next,
    expiresAt,
    matchCode,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { code, secret, expiresAt, matchCode };
}

export function nameOf(user: TelegramUser): string {
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

/** Hali hal qilinmagan (tasdiqlanmagan, rad etilmagan, muddati o'tmagan) so'rov. */
function openWhere(ctx: Ctx) {
  return and(
    gt(telegramLogins.expiresAt, ctx.now()),
    isNull(telegramLogins.confirmedAt),
    isNull(telegramLogins.rejectedAt),
  );
}

/**
 * Bot `/start login_<kod>` oldi: so'rovni shu Telegram foydalanuvchisiga bog'laydi (birinchi bosgan) va tafsilotni
 * qaytaradi. `expired` — kod yo'q, eskirgan yoki hal qilingan; `foreign` — boshqa Telegram hisobi ochgan.
 */
export async function openTelegramLogin(
  ctx: Ctx,
  code: string,
  tg: TelegramUser,
): Promise<{ status: "ok"; row: LoginRow } | { status: "expired" | "foreign" }> {
  const telegramUserId = String(tg.id);
  const [row] = await ctx.db
    .select()
    .from(telegramLogins)
    .where(and(eq(telegramLogins.code, code), openWhere(ctx)))
    .limit(1);
  if (row === undefined) return { status: "expired" };
  if (row.telegramUserId !== null && row.telegramUserId !== telegramUserId) {
    return { status: "foreign" };
  }
  if (row.telegramUserId === null) {
    const [bound] = await ctx.db
      .update(telegramLogins)
      .set({ telegramUserId })
      .where(and(eq(telegramLogins.id, row.id), isNull(telegramLogins.telegramUserId)))
      .returning();
    if (bound === undefined) return { status: "foreign" };
    return { status: "ok", row: bound };
  }
  return { status: "ok", row };
}

/** Bot xabari (tugma bosilganda shu xabar tahrirlanadi). */
export async function rememberLoginMessage(
  ctx: Ctx,
  id: string,
  chatId: string,
  messageId: number | null,
): Promise<void> {
  await ctx.db.update(telegramLogins).set({ chatId, messageId }).where(eq(telegramLogins.id, id));
}

export type LoginAnswer = "confirmed" | "not_me" | "wrong_code" | "blocked" | "expired" | "foreign";

/**
 * Tugma bosildi: `choice` — raqam yoki `x` (Bu men emas). Faqat Start bosgan Telegram foydalanuvchisi javob bera
 * oladi; noto'g'ri raqam so'rovni yopadi (taxmin qilib bo'lmaydi).
 */
export async function answerTelegramLogin(
  ctx: Ctx,
  id: string,
  tg: TelegramUser,
  choice: string,
  chatId: string,
): Promise<LoginAnswer> {
  const [row] = await ctx.db
    .select()
    .from(telegramLogins)
    .where(and(eq(telegramLogins.id, id), openWhere(ctx)))
    .limit(1);
  if (row === undefined) return "expired";
  if (row.telegramUserId !== String(tg.id)) return "foreign";

  const reject = async (reason: "not_me" | "wrong_code" | "blocked") => {
    const done = await ctx.db
      .update(telegramLogins)
      .set({ rejectedAt: ctx.now(), rejectReason: reason })
      .where(and(eq(telegramLogins.id, row.id), openWhere(ctx)))
      .returning({ id: telegramLogins.id });
    return done.length === 0 ? ("expired" as const) : reason;
  };

  if (choice === "x") return reject("not_me");
  if (row.matchCode === null || choice !== row.matchCode) return reject("wrong_code");

  const user = await findOrCreateTelegramUser(ctx, tg);
  if (user.blockedAt !== null) return reject("blocked");
  const confirmed = await ctx.db
    .update(telegramLogins)
    .set({ userId: user.id, confirmedAt: ctx.now() })
    .where(and(eq(telegramLogins.id, row.id), openWhere(ctx)))
    .returning({ id: telegramLogins.id });
  if (confirmed.length === 0) return "expired";
  // Xabarnomalar shu chatga (kirish bilan birga avtomatik ulanadi).
  await ctx.db
    .insert(telegramLinks)
    .values({ userId: user.id, chatId, chatTitle: nameOf(tg), linkedAt: ctx.now() })
    .onConflictDoUpdate({
      target: telegramLinks.userId,
      set: { chatId, chatTitle: nameOf(tg), linkedAt: ctx.now(), code: null, codeExpiresAt: null },
    });
  return "confirmed";
}

export type LoginPoll =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "rejected"; reason: string }
  | { status: "ok"; userId: string; next: string };

/** Brauzer so'rovi: tasdiqlangan bo'lsa bir marta `ok` (keyin `expired`). */
export async function pollTelegramLogin(ctx: Ctx, secret: string): Promise<LoginPoll> {
  const [row] = await ctx.db
    .select()
    .from(telegramLogins)
    .where(eq(telegramLogins.browserHash, hashToken(secret)))
    .limit(1);
  if (row === undefined || row.consumedAt !== null) return { status: "expired" };
  if (row.rejectedAt !== null) return { status: "rejected", reason: row.rejectReason ?? "not_me" };
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
