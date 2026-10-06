/**
 * Kabinetga kirish Telegram orqali: deep link → bot /start login_<kod> → brauzer status → sessiya.
 * Brauzer siri (cookie) bilan bog'langan, bir martalik, 10 daqiqa; ochiq yo'naltirish yo'q; email yo'q.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oauthTokens, telegramLinks, telegramLogins, users } from "../src/db/schema";
import { createTestApp } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeTelegram } from "./helpers/fake-telegram";

let t: TestApp;
let tg: FakeTelegram;

beforeEach(async () => {
  tg = new FakeTelegram();
  t = await createTestApp(
    {
      TELEGRAM_BOT_TOKEN: "TEST:TOKEN",
      TELEGRAM_BOT_USERNAME: "telegrab_app_bot",
      TELEGRAM_API_URL: "https://tg.test",
    },
    undefined,
    { telegramOptions: { fetch: tg.fetch, poll: false } },
  );
});

afterEach(async () => {
  await t.close();
});

async function start(next?: string) {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: next === undefined ? {} : { next },
  });
  const cookie = res.cookies.find((c) => c.name === "aes_tg_login");
  return {
    res,
    data: res.json().data,
    browser: cookie === undefined ? "" : `aes_tg_login=${cookie.value}`,
  };
}

const status = (browser: string) =>
  t.app.inject({ method: "GET", url: "/api/auth/telegram/status", headers: { cookie: browser } });

/** Foydalanuvchi deep link'ni ochib botda Start bosadi. */
async function pressStart(link: string, from = { id: 777, first_name: "Ali", username: "ali_uz" }) {
  const param = new URL(link).searchParams.get("start")!;
  tg.updatesPush({
    chat: { id: from.id, first_name: from.first_name },
    from,
    text: `/start ${param}`,
  });
  await t.app.telegram.pollOnce(0);
}

describe("Telegram orqali kirish", () => {
  it("to'liq oqim: deep link → bot → status → sessiya → /api/me → logout; xabarnomalar ulanadi", async () => {
    const { res, data, browser } = await start("/device?code=ABC123");
    expect(res.statusCode).toBe(200);
    expect(data.link).toMatch(
      /^https:\/\/t\.me\/telegrab_app_bot\?start=login_[A-Za-z0-9_-]{16,48}$/,
    );
    expect(res.cookies.find((c) => c.name === "aes_tg_login")).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect((await status(browser)).json().data).toEqual({ status: "pending" });

    await pressStart(data.link);
    expect(tg.sent.at(-1)).toMatchObject({
      chat_id: "777",
      text: expect.stringContaining("tasdiqlandi"),
    });

    const done = await status(browser);
    expect(done.json().data).toEqual({ status: "ok", next: "/device?code=ABC123" });
    const session = done.cookies.find((c) => c.name === "aes_session")!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    const cookie = `aes_session=${session.value}`;
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).json().data).toMatchObject(
      {
        name: "Ali (@ali_uz)",
      },
    );
    const [user] = await t.db.db.select().from(users).where(eq(users.telegramId, "777"));
    expect(user).toMatchObject({ email: null, name: "Ali (@ali_uz)" });
    const [link] = await t.db.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, user!.id));
    expect(link).toMatchObject({ chatId: "777" });

    // Bir martalik: qayta status — sessiya berilmaydi.
    expect((await status(browser)).json().data).toEqual({ status: "expired" });

    await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("qayta kirish o'sha hisobga (Telegram id bo'yicha), ism yangilanadi", async () => {
    const first = await start();
    await pressStart(first.data.link);
    await status(first.browser);
    const second = await start();
    await pressStart(second.data.link, { id: 777, first_name: "Alisher", username: "ali_uz" });
    await status(second.browser);
    const all = await t.db.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Alisher (@ali_uz)");
  });

  it("kod boshqa brauzerga sessiya bermaydi; eskirgan va ishlatilgan kod rad etiladi", async () => {
    const a = await start();
    const b = await start();
    await pressStart(a.data.link);
    expect((await status(b.browser)).json().data).toEqual({ status: "pending" });
    expect((await status("aes_tg_login=soxta")).json().data).toEqual({ status: "expired" });
    expect((await status("")).json().data).toEqual({ status: "expired" });

    // Ishlatilgan kod bilan qayta Start — rad etiladi.
    await pressStart(a.data.link, { id: 999, first_name: "Begona", username: "x" });
    expect(tg.sent.at(-1)!.text).toMatch(/eskirgan/);

    t.clock.advance(11 * 60_000);
    await pressStart(b.data.link);
    expect(tg.sent.at(-1)!.text).toMatch(/eskirgan/);
    expect((await status(b.browser)).json().data).toEqual({ status: "expired" });
  });

  it("DB'da sessiya tokenining o'zi emas, hash; brauzer siri ham hash", async () => {
    const { data, browser } = await start();
    await pressStart(data.link);
    const done = await status(browser);
    const token = done.cookies.find((c) => c.name === "aes_session")!.value;
    const rows = await t.db.db.select().from(oauthTokens);
    expect(rows.some((r) => r.hash === token)).toBe(false);
    const secret = browser.split("=")[1]!;
    const logins = await t.db.db.select().from(telegramLogins);
    expect(logins.some((r) => r.browserHash === secret)).toBe(false);
  });

  it("tashqi `next` qabul qilinmaydi; bot sozlanmagan bo'lsa 503", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/\\evil"]) {
      expect((await start(next)).res.statusCode).toBe(400);
    }
    const plain = await createTestApp();
    const res = await plain.app.inject({ method: "POST", url: "/api/auth/telegram", payload: {} });
    expect(res.statusCode).toBe(503);
    await plain.close();
    expect((await t.app.inject({ url: "/api/me" })).statusCode).toBe(401);
  });

  it("email (magic link) yo'li olib tashlangan", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "a@b.uz" },
    });
    expect(res.statusCode).toBe(404);
  });
});
