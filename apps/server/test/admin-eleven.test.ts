/** Admin → Audio: markaziy ElevenLabs kaliti (env'dan ko'chirish, shifrlash, tekshirish), kvota va sarf. */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { systemSettings, usageLedger, users } from "../src/db/schema";
import { ELEVEN_SETTINGS_KEY } from "../src/eleven/service";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";

let t: TestApp;
let el: FakeEleven;

afterEach(async () => {
  await t.close();
});

const ADMIN = { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" };

async function start(env: Record<string, string> = {}): Promise<string> {
  el = new FakeEleven();
  t = await createTestApp({ ...ADMIN, ...env }, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  const res = await t.app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { login: "boss", password: "juda-uzun-parol-123" },
  });
  return `aes_admin=${res.cookies.find((c) => c.name === "aes_admin")!.value}`;
}

const admin = (cookie: string, method: "GET" | "PUT" | "DELETE", payload?: object) =>
  t.app.inject({
    method,
    url: "/api/admin/elevenlabs",
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });

describe("admin → Audio", () => {
  it("env'dagi kalit ishga tushganda shifrlanib DB'ga ko'chadi; foydalanuvchilar uchun ham ishlaydi", async () => {
    const cookie = await start({ ELEVENLABS_API_KEY: VALID_KEY });
    const [row] = await t.db.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, ELEVEN_SETTINGS_KEY));
    expect(row!.updatedBy).toBe("env");
    expect(JSON.stringify(row)).not.toContain(VALID_KEY);

    const view = await admin(cookie, "GET");
    expect(view.body).not.toContain(VALID_KEY);
    expect(view.json().data).toMatchObject({
      source: "db",
      masked: "…1234",
      env_key: true,
      account: {
        tier: "creator",
        character_count: 1_000,
        character_limit: 100_000,
        remaining: 99_000,
      },
      error: null,
    });

    // Shaxsiy kaliti yo'q foydalanuvchi: env_check markaziy kalitni ko'radi.
    await login(t, "tenant@x.uz");
    const s = await mcpSession(t, "tenant@x.uz");
    const env = await s.call("env_check");
    expect(env.result.data.checks.elevenlabs).toMatchObject({
      configured: true,
      ok: true,
      remaining_characters: 99_000,
    });
  });

  it("noto'g'ri kalit saqlanmaydi; to'g'risi saqlanadi; o'chirilsa env'ga qaytadi", async () => {
    const cookie = await start();
    expect((await admin(cookie, "GET")).json().data).toMatchObject({
      source: "none",
      masked: null,
      env_key: false,
      account: null,
    });

    const bad = await admin(cookie, "PUT", { api_key: "sk_wrong_key_0000" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("EL_AUTH");
    expect(await t.db.db.select().from(systemSettings)).toEqual([]);

    const good = await admin(cookie, "PUT", { api_key: VALID_KEY });
    expect(good.json().data).toMatchObject({ source: "db", masked: "…1234", updated_by: "admin" });
    expect(good.body).not.toContain(VALID_KEY);

    const removed = await admin(cookie, "DELETE");
    expect(removed.json().data).toMatchObject({ source: "none", masked: null });
    const [row] = await t.db.db.select().from(systemSettings);
    expect(row!.secret).toBeNull();
  });

  it("sarf: joriy davrdagi audio yozuvlari (vaqt chizig'i va to'ldirishsiz)", async () => {
    const cookie = await start({ ELEVENLABS_API_KEY: VALID_KEY });
    await login(t, "u@x.uz");
    const [user] = await t.db.db.select().from(users).where(eq(users.email, "u@x.uz"));
    const row = { userId: user!.id, kind: "charge", unit: "chars", createdAt: t.clock.now };
    await t.db.db.insert(usageLedger).values([
      { ...row, item: "tts", quantity: 1200, costMicros: 360_000, amountMicros: 720_000 },
      { ...row, item: "tts", quantity: 300, costMicros: 0, amountMicros: 0, cached: true },
      {
        ...row,
        item: "timeline",
        unit: "minutes",
        quantity: 1,
        costMicros: 0,
        amountMicros: 50_000,
      },
      { ...row, kind: "topup", item: "topup", unit: "usd", quantity: 5, amountMicros: 5_000_000 },
    ]);
    const usage = (await admin(cookie, "GET")).json().data.usage;
    expect(usage.items).toEqual([
      {
        item: "tts",
        unit: "chars",
        count: 2,
        quantity: 1500,
        cached: 1,
        cost_usd: 0.36,
        charged_usd: 0.72,
      },
    ]);
    expect(usage).toMatchObject({ total_cost_usd: 0.36, total_charged_usd: 0.72 });
  });

  it("admin'siz — 401", async () => {
    await start();
    const cookie = await login(t, "x@x.uz");
    expect((await admin(cookie, "GET")).statusCode).toBe(401);
    expect((await admin(cookie, "PUT", { api_key: VALID_KEY })).statusCode).toBe(401);
  });
});
