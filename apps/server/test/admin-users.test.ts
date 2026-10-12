/** P9.02–P9.04: admin → foydalanuvchilar (profil, to'ldirish, bloklash), tariflar va narx sozlamalari. */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { issueToken } from "../src/auth/tokens";
import { auditLog, devices, usageLedger, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const ADMIN = { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" };

let t: TestApp;

afterEach(async () => {
  await t.close();
});

async function adminCookie(): Promise<string> {
  const res = await t.app.inject({
    method: "POST",
    url: "/api/admin/login",
    payload: { login: "boss", password: "juda-uzun-parol-123" },
  });
  expect(res.statusCode).toBe(200);
  return `aes_admin=${res.cookies.find((c) => c.name === "aes_admin")!.value}`;
}

async function userId(label: string): Promise<string> {
  const [row] = await t.db.db.select().from(users).where(eq(users.email, label));
  return row!.id;
}

describe("admin → foydalanuvchilar", () => {
  it("ro'yxat, qidiruv, holat filtri va profil; admin cookie'siz 401", async () => {
    t = await createTestApp(ADMIN);
    await login(t, "ali@x.uz");
    await login(t, "vali@x.uz");
    const admin = await adminCookie();
    expect((await t.app.inject({ url: "/api/admin/users" })).statusCode).toBe(401);

    const all = await t.app.inject({ url: "/api/admin/users", headers: { cookie: admin } });
    expect(all.json().data).toMatchObject({ total: 2, next_offset: null });
    const found = await t.app.inject({
      url: "/api/admin/users?q=VALI",
      headers: { cookie: admin },
    });
    expect(found.json().data.users.map((u: { email: string }) => u.email)).toEqual(["vali@x.uz"]);
    // LIKE belgilari qidiruvda oddiy matn sifatida.
    const escaped = await t.app.inject({
      url: "/api/admin/users?q=%25",
      headers: { cookie: admin },
    });
    expect(escaped.json().data.total).toBe(0);

    const id = await userId("ali@x.uz");
    await t.db.db.insert(devices).values({ userId: id, name: "PC", os: "win" });
    const profile = await t.app.inject({
      url: `/api/admin/users/${id}`,
      headers: { cookie: admin },
    });
    expect(profile.json().data).toMatchObject({
      id,
      account: { activated: false, balance_usd: 0 },
      devices: [{ name: "PC", online: false }],
      sessions: 1,
      jobs: [],
    });
    const missing = await t.app.inject({
      url: "/api/admin/users/00000000-0000-4000-8000-000000000000",
      headers: { cookie: admin },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("tarif bilan to'ldirish (bonus) faollashtiradi; erkin summa va tuzatish; hammasi audit'da", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await login(t, "pay@x.uz");
    const id = await userId("pay@x.uz");
    const admin = await adminCookie();

    const created = await t.app.inject({
      method: "POST",
      url: "/api/admin/tariffs",
      headers: { cookie: admin },
      payload: { name: "Start", description: "Boshlash", price_usd: 20, credit_usd: 22 },
    });
    expect(created.json().data).toMatchObject({ name: "Start", bonus_usd: 2, active: true });
    const tariffId = created.json().data.id as string;
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/admin/tariffs",
      headers: { cookie: admin },
      payload: { name: "", price_usd: -1, credit_usd: 1 },
    });
    expect(bad.statusCode).toBe(400);

    const both = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/topup`,
      headers: { cookie: admin },
      payload: { usd: 5, tariff_id: tariffId },
    });
    expect(both.statusCode).toBe(400);

    const viaTariff = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/topup`,
      headers: { cookie: admin },
      payload: { tariff_id: tariffId, note: "Click" },
    });
    expect(viaTariff.json().data).toMatchObject({ activated: true, balance_usd: 22 });
    const payg = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/topup`,
      headers: { cookie: admin },
      payload: { usd: 3.5 },
    });
    expect(payg.json().data.balance_usd).toBeCloseTo(25.5);
    await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/topup`,
      headers: { cookie: admin },
      payload: { usd: -0.5, note: "xato" },
    });

    const rows = await t.db.db.select().from(usageLedger).where(eq(usageLedger.userId, id));
    const tariffRow = rows.find((row) => row.tariffId === tariffId)!;
    expect(tariffRow).toMatchObject({ kind: "topup", createdBy: "admin:boss" });
    expect(tariffRow.note).toContain("Tarif «Start» — to'lov 20 $. Click");
    expect(rows.find((row) => row.kind === "adjust")).toMatchObject({ amountMicros: -500_000 });

    // Kabinet: faol tariflar va to'lov kontakti ko'rinadi.
    await t.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie: admin },
      payload: { contact: "@aes_admin" },
    });
    const me = await t.app.inject({ url: "/api/me/billing", headers: { cookie } });
    expect(me.json().data).toMatchObject({
      balance_usd: 25,
      contact: "@aes_admin",
      tariffs: [{ name: "Start", price_usd: 20, credit_usd: 22 }],
    });
    // Nofaol tarif kabinetda ko'rinmaydi.
    await t.app.inject({
      method: "PATCH",
      url: `/api/admin/tariffs/${tariffId}`,
      headers: { cookie: admin },
      payload: { active: false },
    });
    const hidden = await t.app.inject({ url: "/api/me/billing", headers: { cookie } });
    expect(hidden.json().data.tariffs).toEqual([]);

    const actions = (await t.db.db.select().from(auditLog)).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["admin.tariff.create", "admin.user.topup", "admin.pricing.update"]),
    );
  });

  it("bloklash: kabinet, panel va Claude tokenlari bekor; WS uziladi; blokdan chiqqach yangi kirish ishlaydi", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await login(t, "bad@x.uz");
    const id = await userId("bad@x.uz");
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId: id, name: "PC", os: "win" })
      .returning();
    const { token: deviceToken } = await issueToken(t.db.db, {
      kind: "device",
      ttlMs: null,
      now: t.clock.now,
      userId: id,
      deviceId: device!.id,
    });
    const agent = new FakeAgent(t.app.hub, { userId: id, deviceId: device!.id }, { root: "D:/r" });
    agent.connect();
    expect(t.app.hub.isOnline(device!.id)).toBe(true);
    const mcp = await mcpSession(t, "bad@x.uz");
    const admin = await adminCookie();

    const blocked = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/block`,
      headers: { cookie: admin },
      payload: { reason: "spam" },
    });
    expect(blocked.json().data.revoked).toBeGreaterThanOrEqual(3);
    expect(t.app.hub.isOnline(device!.id)).toBe(false);

    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
    const panel = await t.app.inject({
      url: "/api/agent/billing",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(panel.statusCode).toBe(401);
    await expect(mcp.call("devices_list")).rejects.toThrow(/MCP HTTP 401/);

    // Bloklangan foydalanuvchiga yangi token berilsa ham (masalan eski oqim) — rad etiladi.
    const fresh = await login(t, "bad@x.uz");
    expect((await t.app.inject({ url: "/api/me", headers: { cookie: fresh } })).statusCode).toBe(
      401,
    );

    const profile = await t.app.inject({
      url: `/api/admin/users/${id}`,
      headers: { cookie: admin },
    });
    expect(profile.json().data).toMatchObject({ blocked_reason: "spam", sessions: 1 });

    await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/unblock`,
      headers: { cookie: admin },
    });
    // Eski tokenlar bekorligicha qoladi; yangi kirish ishlaydi.
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
    const again = await login(t, "bad@x.uz");
    expect((await t.app.inject({ url: "/api/me", headers: { cookie: again } })).statusCode).toBe(
      200,
    );
  });

  it("sessiyalarni bekor qilish (Claude ulanishi ixtiyoriy)", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await login(t, "s@x.uz");
    const id = await userId("s@x.uz");
    const mcp = await mcpSession(t, "s@x.uz");
    const admin = await adminCookie();
    const res = await t.app.inject({
      method: "POST",
      url: `/api/admin/users/${id}/logout`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(res.json().data.revoked).toBe(1);
    expect((await t.app.inject({ url: "/api/me", headers: { cookie } })).statusCode).toBe(401);
    expect((await mcp.call("devices_list")).isError).toBe(false);
  });
});

describe("admin → narx sozlamalari (P9.04)", () => {
  it("stavka o'zgarsa narxlar darhol yangilanadi; chegaradan tashqari qiymat rad; yuborilmagani kodga qaytadi", async () => {
    t = await createTestApp(ADMIN);
    const cookie = await login(t, "p@x.uz");
    const admin = await adminCookie();
    const initial = await t.app.inject({ url: "/api/admin/pricing", headers: { cookie: admin } });
    expect(initial.json().data).toMatchObject({ overrides: {}, rates: { markup: 2.4 } });

    const invalid = await t.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie: admin },
      payload: { rates: { markup: 0.5 } },
    });
    expect(invalid.statusCode).toBe(400);
    const unknown = await t.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie: admin },
      payload: { rates: { foo: 1 } },
    });
    expect(unknown.statusCode).toBe(400);

    const saved = await t.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie: admin },
      payload: { rates: { markup: 3, cost: { musicPerMinute: 0.2 } } },
    });
    expect(saved.json().data.rates).toMatchObject({
      markup: 3,
      basicRatio: 0.1,
      cost: { musicPerMinute: 0.2, isolatePerMinute: 0.12 },
    });
    const me = await t.app.inject({ url: "/api/me/billing", headers: { cookie } });
    expect(me.json().data.prices.music_pro_per_min).toBeCloseTo(0.6);
    expect(me.json().data.prices.isolation_pro_per_min).toBeCloseTo(0.36);

    // Boshqa replika (yangi BillingService) DB'dan shu stavkalarni oladi.
    const { BillingService } = await import("../src/billing/service");
    const other = new BillingService({ db: t.db.db, now: () => t.clock.now, env: {} as never });
    await other.loadSettings();
    expect(other.rates.markup).toBe(3);

    await t.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie: admin },
      payload: {},
    });
    const reset = await t.app.inject({ url: "/api/admin/pricing", headers: { cookie: admin } });
    expect(reset.json().data.rates.markup).toBe(2.4);
  });

  it("umumiy ko'rsatkichlar: tushum, sarf, tannarx va marja", async () => {
    t = await createTestApp(ADMIN);
    await login(t, "o@x.uz");
    const id = await userId("o@x.uz");
    await t.app.billing.topup(id, 20, "test");
    await t.app.billing.charge({
      userId: id,
      quote: { item: "music.pro", quantity: 60, unit: "seconds", costUsd: 0.15, priceUsd: 0.36 },
    });
    const admin = await adminCookie();
    const res = await t.app.inject({ url: "/api/admin/overview", headers: { cookie: admin } });
    expect(res.json().data).toMatchObject({
      users: { total: 1, activated: 1, blocked: 0 },
      all_time: { topup_usd: 20, spent_usd: 0.36, cost_usd: 0.15, margin_usd: 0.21 },
    });
  });
});

describe("balans eslatmasi (P9.08)", () => {
  it("sarf 1 $ chegarasini kesib o'tganda bir marta xabar", async () => {
    t = await createTestApp();
    await login(t, "low@x.uz");
    const id = await userId("low@x.uz");
    const lows: number[] = [];
    t.app.billing.listen({ low: (_user, balance) => lows.push(balance) });
    await t.app.billing.topup(id, 20, "test");
    const spend = (usd: number) =>
      t.app.billing.charge({
        userId: id,
        quote: { item: "tts", quantity: 1, unit: "chars", costUsd: usd, priceUsd: usd },
      });
    await spend(18.5);
    expect(lows).toEqual([]);
    await spend(0.8);
    expect(lows).toHaveLength(1);
    expect(lows[0]).toBeCloseTo(0.7);
    await spend(0.1);
    expect(lows).toHaveLength(1);
  });
});
