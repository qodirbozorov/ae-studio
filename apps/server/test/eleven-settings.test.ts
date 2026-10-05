/**
 * P4.01: ElevenLabs kaliti — kabinetda kiritish (tekshirib, shifrlab), holat, o'chirish; CHECK va env_check; xatolar xaritasi.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { ElevenClient, mapElevenError } from "../src/eleven/client";
import { devices, projects, secrets, users } from "../src/db/schema";
import { decrypt, encrypt } from "../src/secrets";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";

let t: TestApp;
let el: FakeEleven;
let cookie: string;

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  cookie = await login(t, "el@x.uz");
});

afterEach(async () => {
  await t.close();
});

const settings = (method: "GET" | "PUT" | "DELETE", payload?: object) =>
  t.app.inject({
    method,
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    ...(payload === undefined ? {} : { payload }),
  });

describe("kalit (kabinet)", () => {
  it("noto'g'ri kalit saqlanmaydi; to'g'ri kalit shifrlanadi, faqat …1234 ko'rinadi; o'chirish", async () => {
    expect((await settings("GET")).json().data).toMatchObject({ configured: false, masked: null });

    const bad = await settings("PUT", { api_key: "sk_wrong_key_0000" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("EL_AUTH");
    expect(await t.db.db.select().from(secrets)).toEqual([]);

    const good = await settings("PUT", { api_key: VALID_KEY });
    expect(good.json().data).toMatchObject({
      configured: true,
      masked: "…1234",
      tier: "creator",
      remaining: 99_000,
      next_reset: expect.any(String),
    });
    expect(good.body).not.toContain(VALID_KEY);
    const [row] = await t.db.db.select().from(secrets);
    expect(row!.ciphertext).not.toContain(VALID_KEY);
    expect(row!.provider).toBe("elevenlabs");

    const audit = await t.app.inject({ url: "/api/audit", headers: { cookie } });
    expect(audit.json().data[0]).toMatchObject({ action: "elevenlabs.key_set", target: "…1234" });

    await settings("DELETE");
    expect((await settings("GET")).json().data.configured).toBe(false);
    expect((await t.app.inject({ url: "/api/settings/elevenlabs" })).statusCode).toBe(401);
  });

  it("AES-256-GCM: buzilgan shifr ochilmaydi", () => {
    const key = Buffer.alloc(32, 7);
    const sealed = encrypt(key, "maxfiy");
    expect(decrypt(key, sealed)).toBe("maxfiy");
    const tampered = { ...sealed, ciphertext: Buffer.from("boshqa").toString("base64") };
    expect(() => decrypt(key, tampered)).toThrow();
  });
});

describe("xatolar xaritasi va retry", () => {
  it("401/402/429/5xx/4xx → EL_* kodlari", () => {
    expect(mapElevenError(401, {}).code).toBe("EL_AUTH");
    expect(mapElevenError(402, {}).code).toBe("EL_QUOTA");
    expect(
      mapElevenError(400, { detail: { status: "quota_exceeded", message: "quota" } }).code,
    ).toBe("EL_QUOTA");
    expect(mapElevenError(429, {}).code).toBe("EL_RATE_LIMIT");
    expect(mapElevenError(503, {}).code).toBe("EL_TIMEOUT");
    expect(mapElevenError(422, { detail: [{ msg: "bad" }] }).code).toBe("EL_BAD_PARAMS");
  });

  it("429 va 5xx da 3 marta qayta urinadi (exponential), keyin xato", async () => {
    const sleeps: number[] = [];
    const client = new ElevenClient(VALID_KEY, {
      fetch: el.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    el.failNext = { status: 429, times: 2 };
    const sub = await client.json<{ tier: string }>("GET", "/v1/user/subscription");
    expect(sub.tier).toBe("creator");
    expect(sleeps).toEqual([500, 1000]);

    el.failNext = { status: 503, times: 10 };
    await expect(client.json("GET", "/v1/user/subscription")).rejects.toMatchObject({
      error: { code: "EL_TIMEOUT" },
    });
    expect(sleeps).toEqual([500, 1000, 500, 1000, 2000]);

    el.failNext = { status: 422, times: 1 };
    await expect(client.json("GET", "/v1/user/subscription")).rejects.toMatchObject({
      error: { code: "EL_BAD_PARAMS" },
    });
  });
});

describe("CHECK va env_check", () => {
  it("audio'li spec: kalit yo'q → BLOCKED EL_AUTH; kvota 0 → EL_QUOTA; env_check holati", async () => {
    const [user] = await t.db.db.select().from(users).where(eq(users.email, "el@x.uz"));
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId: user!.id, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
      .returning();
    const agent = new FakeAgent(
      t.app.hub,
      { userId: user!.id, deviceId: device!.id },
      { root: "D:/r" },
    );
    agent.connect();
    const s = await mcpSession(t, "el@x.uz");

    let env = await s.call("env_check");
    expect(env.result.data.checks.elevenlabs).toMatchObject({ configured: false, ok: false });
    expect(env.result.data.ready).toBe(true);

    const spec = {
      ...THREE_SCENES,
      audio: { voiceover: { kind: "tts", voice_id: "voice_uz_1", text: "Salom." } },
    };
    await s.call("plan_write", { project_id: project!.id, spec });
    let job = (await s.call("build_start", { project_id: project!.id })).result.data.id;
    await t.app.jobs.idle();
    expect((await s.call("job_status", { job_id: job })).result.data.error.code).toBe("EL_AUTH");
    await s.call("job_cancel", { job_id: job });
    await t.app.jobs.idle();

    await settings("PUT", { api_key: VALID_KEY });
    env = await s.call("env_check");
    expect(env.result.data.checks.elevenlabs).toMatchObject({
      configured: true,
      ok: true,
      tier: "creator",
      remaining_characters: 99_000,
    });
    expect(agent.ofType("elevenlabs.status").at(-1)).toMatchObject({ configured: true, ok: true });

    el.subscription.character_count = el.subscription.character_limit;
    t.clock.advance(61_000);
    job = (await s.call("build_start", { project_id: project!.id })).result.data.id;
    await t.app.jobs.idle();
    expect((await s.call("job_status", { job_id: job })).result.data.error.code).toBe("EL_QUOTA");
  });
});
