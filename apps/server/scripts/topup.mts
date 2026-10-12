/**
 * Balansni qo'lda to'ldirish (admin panel — Faza 9 — tayyor bo'lguncha).
 *   railway run --service server -- pnpm --filter @aes/server topup <telegram_id|email|user_id> <usd> [izoh]
 * Lokal kompyuterdan: Railway ichki manzili ochiq emas — `DATABASE_PUBLIC_URL` (Postgres servisidagi) ishlatiladi.
 * Jami to'ldirish boshlang'ich to'lovga (20 $) yetganda hisob faollashadi. Manfiy summa — tuzatish.
 */
import { eq, or } from "drizzle-orm";
import { BillingService } from "../src/billing/service";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { loadEnv } from "../src/env";

const [who, amount, ...rest] = process.argv.slice(2);
const usd = Number(amount);
if (who === undefined || !Number.isFinite(usd) || usd === 0) {
  console.error("Foydalanish: topup <telegram_id|email|user_id> <usd> [izoh]");
  process.exit(1);
}

const env = loadEnv();
const handle = createDb(process.env.DATABASE_PUBLIC_URL ?? env.DATABASE_URL);
try {
  const uuid = /^[0-9a-f-]{36}$/i.test(who);
  const [user] = await handle.db
    .select()
    .from(users)
    .where(
      uuid
        ? eq(users.id, who)
        : or(eq(users.telegramId, who.replace(/^@/, "")), eq(users.email, who)),
    );
  if (user === undefined) {
    console.error(`Foydalanuvchi topilmadi: ${who}`);
    process.exit(1);
  }
  const billing = new BillingService({ db: handle.db, now: () => new Date(), env });
  const account = await billing.topup(user.id, usd, "script", rest.join(" ") || undefined);
  console.log(
    `${user.name ?? user.id}: balans ${account.balance_usd.toFixed(2)} $, ` +
      `faol: ${account.activated ? "ha" : `yo'q (${account.activation_usd} $ kerak)`}`,
  );
} finally {
  await handle.close();
}
