/** P8.01: sarf jurnali, balans, faollashtirish va cheklov. */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { devices, projects, usageLedger, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";

let t: TestApp;
let cookie: string;
let userId: string;
let projectId: string;
let agent: FakeAgent;

async function setup(env: Record<string, string> = {}): Promise<void> {
  const el = new FakeEleven();
  t = await createTestApp(env, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  cookie = await login(t, "billing@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "billing@x.uz"));
  userId = user!.id;
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(t.app.hub, { userId, deviceId: device!.id }, { root: "D:/r" });
  await t.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    payload: { api_key: VALID_KEY },
  });
}

afterEach(async () => {
  await t.close();
});

const tts = (text = "Salom. Dunyo!") => ({
  userId,
  projectId,
  kind: "tts" as const,
  label: "Voiceover",
  params: { voice_id: "voice_uz_1", text, model_id: "eleven_v4", language_code: "uz" },
});

async function ledger() {
  return t.db.db.select().from(usageLedger).where(eq(usageLedger.userId, userId));
}

describe("sarf jurnali", () => {
  it("bajarilgan vazifa tannarxda yoziladi, kesh — yarim narx, bir vazifa bir marta", async () => {
    await setup();
    agent.connect();
    agent.fileDuration = 1.5;
    const first = await t.app.audio.submit(tts());
    await t.app.audio.wait(first.ok ? first.data.id : "", 5000);
    await t.app.audio.idle();
    const again = await t.app.audio.submit(tts());
    expect(again).toMatchObject({ ok: true, data: { cached: true } });
    await t.app.audio.idle();

    const rows = await ledger();
    expect(rows).toHaveLength(2);
    const fresh = rows.find((row) => !row.cached)!;
    const cached = rows.find((row) => row.cached)!;
    // 13 belgi × 0.10 $ / 1000 (TTS — ustamasiz).
    expect(fresh).toMatchObject({ item: "tts", unit: "chars", quantity: 13, amountMicros: -1300 });
    expect(fresh.costMicros).toBe(1300);
    expect(cached).toMatchObject({ amountMicros: -650, costMicros: 0 });

    const billing = await t.app.inject({ url: "/api/me/billing", headers: { cookie } });
    expect(billing.json().data).toMatchObject({
      enforced: false,
      activated: false,
      activation_usd: 20,
    });
    expect(billing.json().data.balance_usd).toBeCloseTo(-0.00195);
    expect(billing.json().data.history).toHaveLength(2);

    // Takroriy yozish (masalan qayta yetkazishda) balansni ikki marta yechmaydi.
    const again2 = await t.app.billing.charge({
      userId,
      audioTaskId: fresh.audioTaskId,
      quote: { item: "tts", quantity: 13, unit: "chars", costUsd: 0.0013, priceUsd: 0.0013 },
    });
    expect(again2).toBe(false);
  });

  it("cheklov: faollashtirilmagan → rad; 20 $ to'ldirilgach ishlaydi; balans yetmasa rad", async () => {
    await setup({ BILLING_ENFORCE: "1" });
    agent.connect();
    const blocked = await t.app.audio.submit(tts());
    expect(blocked).toMatchObject({ ok: false, error: { code: "BILLING_NOT_ACTIVATED" } });

    const partial = await t.app.billing.topup(userId, 10, "test");
    expect(partial).toMatchObject({ activated: false, balance_usd: 10 });
    const full = await t.app.billing.topup(userId, 10, "test");
    expect(full).toMatchObject({ activated: true, balance_usd: 20 });

    const allowed = await t.app.audio.submit(tts());
    expect(allowed.ok).toBe(true);
    await t.app.audio.idle();

    await t.app.billing.topup(userId, -20, "test", "tuzatish");
    const low = await t.app.audio.submit(tts("Boshqa matn"));
    expect(low).toMatchObject({ ok: false, error: { code: "BILLING_BALANCE_LOW" } });
    // Tuzatish (manfiy) faollashtirishni bekor qilmaydi.
    expect((await t.app.billing.account(userId)).activated).toBe(true);
  });
});
