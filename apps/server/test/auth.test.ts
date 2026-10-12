/**
 * Kabinetga kirish Telegram orqali: deep link → bot /start login_<kod> → tafsilot + raqam tugmalari →
 * saytdagi raqam → brauzer status → sessiya (P9.06). Brauzer siri (cookie) bilan bog'langan, bir martalik,
 * 10 daqiqa; noto'g'ri raqam / «Bu men emas» so'rovni yopadi; ochiq yo'naltirish yo'q; email yo'q.
 * Sessiyalar: ro'yxat, bekor qilish, boshqa barchasidan chiqish, rotatsiya. Webhook — secret_token bilan.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLog, oauthTokens, telegramLinks, telegramLogins, users } from "../src/db/schema";
import { createTestApp } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeTelegram } from "./helpers/fake-telegram";

const BOT = {
  TELEGRAM_BOT_TOKEN: "TEST:TOKEN",
  TELEGRAM_BOT_USERNAME: "telegrab_app_bot",
  TELEGRAM_API_URL: "https://tg.test",
};
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ALI = { id: 777, first_name: "Ali", username: "ali_uz" };

let t: TestApp;
let tg: FakeTelegram;

async function setup(env: Record<string, string> = {}): Promise<void> {
  tg = new FakeTelegram();
  t = await createTestApp({ ...BOT, ...env }, undefined, {
    telegramOptions: { fetch: tg.fetch, poll: false },
  });
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await t.close();
});

async function start(next?: string) {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    headers: { "user-agent": CHROME },
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
  t.app.inject({
    method: "GET",
    url: "/api/auth/telegram/status",
    headers: { cookie: browser, "user-agent": CHROME },
  });

/** Foydalanuvchi deep link'ni ochib botda Start bosadi. */
async function pressStart(link: string, from = ALI) {
  const param = new URL(link).searchParams.get("start")!;
  tg.updatesPush({
    chat: { id: from.id, first_name: from.first_name },
    from,
    text: `/start ${param}`,
  });
  await t.app.telegram.pollOnce(0);
}

/** Botdagi tugma: raqam yoki `x` (Bu men emas). */
async function press(choice: string, from = ALI) {
  const { message, buttons } = tg.lastKeyboard();
  const button = buttons.find((b) => b.data.endsWith(`:${choice}`));
  const data =
    button?.data ?? `${buttons[0]!.data.slice(0, buttons[0]!.data.lastIndexOf(":"))}:${choice}`;
  tg.press(from, data, message);
  await t.app.telegram.pollOnce(0);
}

/** To'liq kirish: start → bot → to'g'ri raqam → status → sessiya cookie. */
async function signIn(from = ALI): Promise<string> {
  const { data, browser } = await start();
  await pressStart(data.link, from);
  await press(data.match_code, from);
  const done = await status(browser);
  return `aes_session=${done.cookies.find((c) => c.name === "aes_session")!.value}`;
}

describe("Telegram orqali kirish", () => {
  it("to'liq oqim: deep link → botda tafsilot va raqamlar → to'g'ri raqam → sessiya → /api/me → logout", async () => {
    const { res, data, browser } = await start("/device?code=ABC123");
    expect(res.statusCode).toBe(200);
    expect(data.link).toMatch(
      /^https:\/\/t\.me\/telegrab_app_bot\?start=login_[A-Za-z0-9_-]{16,48}$/,
    );
    expect(data.match_code).toMatch(/^\d{2}$/);
    expect(res.cookies.find((c) => c.name === "aes_tg_login")).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect((await status(browser)).json().data).toEqual({ status: "pending" });

    await pressStart(data.link);
    const { message, buttons } = tg.lastKeyboard();
    expect(message.chat_id).toBe("777");
    expect(message.text).toContain("Brauzer: Chrome · Windows");
    expect(message.text).toMatch(/IP: \S+/);
    expect(message.text).toContain("(Toshkent)");
    const numbers = buttons.filter((b) => /^\d{2}$/.test(b.text)).map((b) => b.text);
    expect(numbers).toHaveLength(3);
    expect(numbers).toContain(data.match_code);
    expect(buttons.some((b) => b.data.endsWith(":x"))).toBe(true);
    // Start'ning o'zi tasdiqlamaydi.
    expect((await status(browser)).json().data).toEqual({ status: "pending" });

    await press(data.match_code);
    expect(tg.edited.at(-1)).toMatchObject({
      message_id: message.message_id,
      text: expect.stringContaining("tasdiqlandi"),
    });

    const done = await status(browser);
    expect(done.json().data).toEqual({ status: "ok", next: "/device?code=ABC123" });
    const session = done.cookies.find((c) => c.name === "aes_session")!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    const cookie = `aes_session=${session.value}`;
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).json().data).toMatchObject(
      { name: "Ali (@ali_uz)" },
    );
    const [user] = await t.db.db.select().from(users).where(eq(users.telegramId, "777"));
    expect(user).toMatchObject({ email: null, name: "Ali (@ali_uz)" });
    const [link] = await t.db.db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.userId, user!.id));
    expect(link).toMatchObject({ chatId: "777" });
    const actions = (await t.db.db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toContain("auth.login");

    // Bir martalik: qayta status — sessiya berilmaydi.
    expect((await status(browser)).json().data).toEqual({ status: "expired" });

    await t.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("noto'g'ri raqam so'rovni yopadi (qayta urinib bo'lmaydi); «Bu men emas» — rad", async () => {
    const a = await start();
    await pressStart(a.data.link);
    const wrong = String(((Number(a.data.match_code) - 10 + 1) % 90) + 10);
    await press(wrong);
    expect(tg.edited.at(-1)!.text).toMatch(/mos kelmadi/);
    expect((await status(a.browser)).json().data).toEqual({
      status: "rejected",
      reason: "wrong_code",
    });
    // To'g'ri raqam endi ishlamaydi.
    await press(a.data.match_code);
    expect(tg.edited.at(-1)!.text).toMatch(/eskirgan|hal qilingan/);
    expect(await t.db.db.select().from(users)).toHaveLength(0);

    const b = await start();
    await pressStart(b.data.link);
    await press("x");
    expect(tg.edited.at(-1)!.text).toMatch(/rad etildi/);
    expect((await status(b.browser)).json().data).toEqual({ status: "rejected", reason: "not_me" });
    expect(await t.db.db.select().from(users)).toHaveLength(0);
  });

  it("havolani boshqa Telegram hisobi ochsa yoki tugmani boshqa odam bossa — rad", async () => {
    const { data, browser } = await start();
    await pressStart(data.link);
    const intruder = { id: 999, first_name: "Begona", username: "x" };
    await pressStart(data.link, intruder);
    expect(tg.sent.at(-1)!.text).toMatch(/boshqa Telegram hisobi/);
    await press(data.match_code, intruder);
    expect(tg.answered.at(-1)!.text).toMatch(/boshqa Telegram hisobi/);
    expect((await status(browser)).json().data).toEqual({ status: "pending" });
    await press(data.match_code);
    expect((await status(browser)).json().data.status).toBe("ok");
  });

  it("qayta kirish o'sha hisobga (Telegram id bo'yicha), ism yangilanadi", async () => {
    await signIn();
    await signIn({ id: 777, first_name: "Alisher", username: "ali_uz" });
    const all = await t.db.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Alisher (@ali_uz)");
  });

  it("bloklangan hisob kira olmaydi", async () => {
    await signIn();
    await t.db.db.update(users).set({ blockedAt: t.clock.now });
    const { data, browser } = await start();
    await pressStart(data.link);
    await press(data.match_code);
    expect(tg.edited.at(-1)!.text).toMatch(/bloklangan/);
    expect((await status(browser)).json().data).toEqual({ status: "rejected", reason: "blocked" });
  });

  it("kod boshqa brauzerga sessiya bermaydi; eskirgan va ishlatilgan kod rad etiladi", async () => {
    const a = await start();
    const b = await start();
    await pressStart(a.data.link);
    await press(a.data.match_code);
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
    await press(data.match_code);
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

describe("sessiyalar (P9.06)", () => {
  it("ro'yxat (brauzer, IP, joriy), bittasini bekor qilish va boshqa barchasidan chiqish", async () => {
    const first = await signIn();
    const second = await signIn();
    const third = await signIn();
    const list = await t.app.inject({ url: "/api/me/sessions", headers: { cookie: first } });
    const sessions = list.json().data.sessions as {
      id: string;
      browser: string;
      current: boolean;
    }[];
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions[0]!.browser).toBe("Chrome · Windows");

    const other = sessions.find((s) => !s.current)!;
    const removed = await t.app.inject({
      method: "DELETE",
      url: `/api/me/sessions/${other.id}`,
      headers: { cookie: first },
    });
    expect(removed.json().data).toEqual({ revoked: true });

    const all = await t.app.inject({
      method: "POST",
      url: "/api/auth/logout-all",
      headers: { cookie: first },
    });
    expect(all.json().data.revoked).toBe(1);
    expect((await t.app.inject({ url: "/api/me", headers: { cookie: first } })).statusCode).toBe(
      200,
    );
    for (const cookie of [second, third]) {
      expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
    }

    // Boshqa foydalanuvchining sessiyasini o'chirib bo'lmaydi.
    const stranger = await signIn({ id: 1234, first_name: "Vali", username: "vali" });
    const foreign = await t.app.inject({
      method: "DELETE",
      url: `/api/me/sessions/${sessions.find((s) => s.current)!.id}`,
      headers: { cookie: stranger },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("rotatsiya: 24 soatdan keyin /api/me yangi cookie beradi, eski qisqa muddat ishlaydi", async () => {
    const cookie = await signIn();
    const early = await t.app.inject({ url: "/api/me", headers: { cookie } });
    expect(early.cookies.find((c) => c.name === "aes_session")).toBeUndefined();

    t.clock.advance(25 * 3600_000);
    const rotated = await t.app.inject({ url: "/api/me", headers: { cookie } });
    const fresh = rotated.cookies.find((c) => c.name === "aes_session")!;
    expect(fresh.value).not.toBe(cookie.split("=")[1]);
    // Parallel so'rov (eski cookie) ham hozircha o'tadi, lekin ikkinchi yangi sessiya yaratilmaydi.
    const parallel = await t.app.inject({ url: "/api/me", headers: { cookie } });
    expect(parallel.statusCode).toBe(200);
    expect(parallel.cookies.find((c) => c.name === "aes_session")).toBeUndefined();

    t.clock.advance(2 * 60_000);
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
    const next = `aes_session=${fresh.value}`;
    expect((await t.app.inject({ url: "/api/me", headers: { cookie: next } })).statusCode).toBe(
      200,
    );
  });
});

describe("Telegram webhook (P9.06)", () => {
  it("siri noto'g'ri yoki yo'q — 401; to'g'ri — update qayta ishlanadi; takroriy update e'tiborsiz", async () => {
    await t.close();
    await setup({ TELEGRAM_WEBHOOK_SECRET: "webhook_secret_0123456789abcdef" });
    const update = {
      update_id: 501,
      message: { chat: { id: 42, first_name: "Ali" }, from: { id: 42 }, text: "/start" },
    };
    const send = (headers: Record<string, string>, payload: object = update) =>
      t.app.inject({ method: "POST", url: "/api/telegram/webhook", headers, payload });

    expect((await send({})).statusCode).toBe(401);
    expect((await send({ "x-telegram-bot-api-secret-token": "xato" })).statusCode).toBe(401);
    const good = { "x-telegram-bot-api-secret-token": "webhook_secret_0123456789abcdef" };
    expect((await send(good)).statusCode).toBe(200);
    expect(tg.sent).toHaveLength(1);
    expect((await send(good)).statusCode).toBe(200);
    expect(tg.sent).toHaveLength(1);
    expect((await send(good, { foo: 1 })).statusCode).toBe(400);

    // Webhook bilan to'liq kirish oqimi.
    const { data, browser } = await start();
    const param = new URL(data.link).searchParams.get("start")!;
    await send(good, {
      update_id: 502,
      message: { chat: { id: 777 }, from: ALI, text: `/start ${param}` },
    });
    const { message, buttons } = tg.lastKeyboard();
    const button = buttons.find((b) => b.text === data.match_code)!;
    await send(good, {
      update_id: 503,
      callback_query: {
        id: "q1",
        from: ALI,
        data: button.data,
        message: { message_id: message.message_id, chat: { id: 777 } },
      },
    });
    expect((await status(browser)).json().data.status).toBe("ok");

    expect((await t.app.telegram.registerWebhook("https://aes.test")).ok).toBe(true);
    expect(tg.calls.find((c) => c.method === "setWebhook")!.body).toMatchObject({
      url: "https://aes.test/api/telegram/webhook",
      secret_token: "webhook_secret_0123456789abcdef",
      allowed_updates: ["message", "callback_query"],
    });
  });

  it("webhook siri berilmagan bo'lsa route yopiq", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "anything_anything_anything" },
      payload: { update_id: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});
