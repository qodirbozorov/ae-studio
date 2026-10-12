/** P8.03: audio vazifalari alohida worker'da (DB navbati), server (`api`) natijani kuzatadi. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AudioService } from "../src/audio/service";
import type { AppContext } from "../src/context";
import { audioTasks, devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";

let t: TestApp;
let userId: string;
let projectId: string;
let agent: FakeAgent;
let api: AudioService;
let worker: AudioService;

beforeEach(async () => {
  const el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  const cookie = await login(t, "worker@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "worker@x.uz"));
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
  const ctx = {
    db: t.db.db,
    hub: t.app.hub,
    now: () => t.clock.now,
    storage: t.app.storage,
    eleven: t.app.eleven,
    billing: t.app.billing,
  } as unknown as AppContext;
  // Asosiy ilovadagi (all) navbat bu testda ishlamasin.
  t.app.audio.stop();
  api = new AudioService(ctx, t.app.log, { role: () => "api" });
  worker = new AudioService(ctx, t.app.log, { role: () => "worker" });
});

afterEach(async () => {
  api.stop();
  worker.stop();
  await worker.idle();
  await t.close();
});

describe("api ↔ worker", () => {
  it("api navbatga qo'yadi, worker bajaradi, api kutayotganga xabar beradi va panelga yetkazadi", async () => {
    agent.connect();
    agent.fileDuration = 1.2;
    const submitted = await api.submit({
      userId,
      projectId,
      kind: "tts",
      label: "Voiceover",
      params: { voice_id: "voice_uz_1", text: "Salom dunyo", model_id: "eleven_v4" },
    });
    expect(submitted).toMatchObject({ ok: true, data: { status: "queued" } });
    const id = submitted.ok ? submitted.data.id : "";
    await api.idle();
    // api o'zi bajarmaydi.
    expect((await api.get(id))!.status).toBe("queued");

    // watchSince — vazifa yaratilishidan oldin.
    t.clock.advance(-5000);
    api.startWatching(60_000);
    t.clock.advance(5000);
    const waiting = api.wait(id, 10_000);

    await worker.pollOnce();
    await worker.idle();
    expect((await worker.get(id))!.status).toBe("done");

    await api.watchOnce();
    const done = await waiting;
    expect(done).toMatchObject({ id, status: "done" });
    await api.idle();
    const row = (await api.get(id))!;
    expect(row.deliveredAt).not.toBeNull();
    expect(agent.files.get(row.localPath!)).toBe(row.sha256);
  });

  it("lease: o'lgan worker'ning eski 'running' vazifasi qaytadi, yangisiga tegilmaydi", async () => {
    const [old] = await t.db.db
      .insert(audioTasks)
      .values({
        userId,
        projectId,
        kind: "tts",
        params: { text: "a" },
        paramsHash: "h1",
        status: "running",
        updatedAt: new Date(t.clock.now.getTime() - 41 * 60_000),
      })
      .returning();
    const [fresh] = await t.db.db
      .insert(audioTasks)
      .values({
        userId,
        projectId,
        kind: "tts",
        params: { text: "b" },
        paramsHash: "h2",
        status: "running",
        updatedAt: t.clock.now,
      })
      .returning();
    worker.stop();
    expect(await worker.recover({ leaseMs: 40 * 60_000 })).toBe(1);
    expect((await worker.get(old!.id))!.status).toBe("queued");
    expect((await worker.get(fresh!.id))!.status).toBe("running");
  });
});
