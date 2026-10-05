/**
 * P4.03: audio_task — kesh, navbat, storage, panelga yetkazish (file.download), qayta urinish, tiklash.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonical, paramsHash } from "../src/audio/service";
import { audioTasks, devices, elevenCache, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";

let t: TestApp;
let el: FakeEleven;
let cookie: string;
let userId: string;
let projectId: string;
let agent: FakeAgent;

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  cookie = await login(t, "audio@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "audio@x.uz"));
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
});

afterEach(async () => {
  await t.close();
});

const setKey = () =>
  t.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    payload: { api_key: VALID_KEY },
  });

const ttsInput = (text = "Salom. Dunyo!") => ({
  userId,
  projectId,
  kind: "tts" as const,
  label: "Voiceover",
  params: { voice_id: "voice_uz_1", text, model_id: "eleven_v4", language_code: "uz" },
});

describe("hash", () => {
  it("kalit tartibiga bog'liq emas; kirish fayllari hash'ga kiradi", () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
    expect(paramsHash("tts", { a: 1, b: 2 })).toBe(paramsHash("tts", { b: 2, a: 1 }));
    expect(paramsHash("tts", { a: 1 })).not.toBe(paramsHash("sfx", { a: 1 }));
    const input = { name: "audio", storage_key: "k", sha256: "aa" };
    expect(paramsHash("stt", {}, [input])).not.toBe(
      paramsHash("stt", {}, [{ ...input, sha256: "bb" }]),
    );
  });
});

describe("navbat, storage va yetkazish", () => {
  it("TTS → storage → panel audio/ ga; kesh: qayta chaqiruvda kredit sarflanmaydi", async () => {
    await setKey();
    agent.connect();
    agent.fileDuration = 1.5;
    const first = await t.app.audio.submit(ttsInput());
    expect(first).toMatchObject({ ok: true, data: { status: "queued", credits: 13 } });
    const done = await t.app.audio.wait(first.ok ? first.data.id : "", 5000);
    await t.app.audio.idle();
    const row = (await t.app.audio.get(done!.id))!;
    expect(row).toMatchObject({ status: "done", cached: false, ext: "wav" });
    // Davomiylik TTS alignment'idan (panel o'lchami ustidan yozilmaydi).
    expect(row.durationMs).toBe(1080);
    expect(row.localPath).toBe(`audio/tts_${row.sha256!.slice(0, 12)}.wav`);
    expect(agent.files.get(row.localPath!)).toBe(row.sha256);
    expect(await t.app.storage.head(row.storageKey!)).not.toBeNull();
    expect(
      (row.result as { alignment: { characters: string[] } }).alignment.characters.length,
    ).toBe(13);
    const generations = el.generationCalls().length;

    const again = await t.app.audio.submit(ttsInput());
    expect(again).toMatchObject({ ok: true, data: { status: "done", cached: true, credits: 0 } });
    await t.app.audio.idle();
    expect(el.generationCalls()).toHaveLength(generations);
    const cachedRow = (await t.app.audio.get(again.ok ? again.data.id : ""))!;
    expect(cachedRow.localPath).toBe(row.localPath);

    const fresh = await t.app.audio.submit({ ...ttsInput(), fresh: true });
    await t.app.audio.wait(fresh.ok ? fresh.data.id : "", 5000);
    expect(el.generationCalls()).toHaveLength(generations + 1);
  });

  it("panel ulanmagan → natija storage'da kutadi, ulanganda yetkaziladi; davomiylik paneldan (SFX)", async () => {
    await setKey();
    agent.fileDuration = 0.8;
    const task = await t.app.audio.submit({
      userId,
      projectId,
      kind: "sfx",
      params: { text: "whoosh" },
    });
    await t.app.audio.wait(task.ok ? task.data.id : "", 5000);
    await t.app.audio.idle();
    let row = (await t.app.audio.get(task.ok ? task.data.id : ""))!;
    expect(row).toMatchObject({
      status: "done",
      localPath: null,
      deliveredAt: null,
      durationMs: null,
    });

    agent.connect();
    for (let i = 0; i < 50 && row.localPath === null; i++) {
      await new Promise((r) => setTimeout(r, 20));
      row = (await t.app.audio.get(row.id))!;
    }
    expect(row.localPath).toMatch(/^audio\/sfx_[0-9a-f]{12}\.wav$/);
    expect(row.durationMs).toBe(800);
    const [cache] = await t.db.db
      .select()
      .from(elevenCache)
      .where(eq(elevenCache.paramsHash, row.paramsHash));
    expect(cache!.durationMs).toBe(800);
    expect(agent.ofType("audio.update").map((m) => m.task.status)).toContain("done");
  });

  it("kalit yo'q → failed EL_AUTH; kalit kiritilgach retry → done", async () => {
    const task = await t.app.audio.submit(ttsInput("Kalitsiz."));
    const failed = await t.app.audio.wait(task.ok ? task.data.id : "", 5000);
    expect(failed).toMatchObject({ status: "failed", error: { code: "EL_AUTH" } });
    await setKey();
    await t.app.audio.retry(failed!.id);
    expect(await t.app.audio.wait(failed!.id, 5000)).toMatchObject({ status: "done" });
    expect((await t.app.audio.retry(failed!.id)).ok).toBe(false);
  });

  it("server qayta ishga tushsa queued/running vazifalar davom etadi", async () => {
    await setKey();
    const [row] = await t.db.db
      .insert(audioTasks)
      .values({
        userId,
        projectId,
        kind: "sfx",
        params: { text: "boom", duration_seconds: 1 },
        paramsHash: paramsHash("sfx", { text: "boom", duration_seconds: 1 }),
        status: "running",
      })
      .returning();
    expect(await t.app.audio.recover()).toBe(1);
    expect(await t.app.audio.wait(row!.id, 5000)).toMatchObject({
      status: "done",
      durationMs: 1000,
    });
  });

  it("MCP audio_tasks_status", async () => {
    await setKey();
    const task = await t.app.audio.submit(ttsInput());
    await t.app.audio.wait(task.ok ? task.data.id : "", 5000);
    const s = await mcpSession(t, "audio@x.uz");
    const res = await s.call("audio_tasks_status", { project_id: projectId });
    expect(res.result.data).toEqual([
      expect.objectContaining({
        kind: "tts",
        label: "Voiceover",
        status: "done",
        cached: false,
        credits: 13,
      }),
    ]);
  });
});
