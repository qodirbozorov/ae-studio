/**
 * P4.09–P4.11: AUDIO holati job ichida — vazifalar, kvota gate, TTS-first timing, musiqa uzunligi, ducking,
 * SFX langari, subtitr; kesh (qayta job — kredit yo'q); SFX xatosi skipped, voiceover xatosi BLOCKED.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { audioTasks, devices, ops, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/reel";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8, has_audio: true },
  },
  {
    key: "photo_02",
    local_path: "source/photo_02.jpg",
    kind: "image",
    meta: { width: 1000, height: 1500 },
  },
  { key: "ding", local_path: "audio/ding.wav", kind: "audio", meta: { duration: 1 } },
];

/** 3 gapli voiceover; sahnalar gaplarga bog'langan. */
const VO_TEXT = "Bugun uch sir. Birinchisi oddiy! Obuna bo'ling.";
const SPEC = {
  ...THREE_SCENES,
  scenes: [
    { ...THREE_SCENES.scenes[0], dur: "vo:0-1" },
    { ...THREE_SCENES.scenes[1], dur: "vo:1-2" },
    { ...THREE_SCENES.scenes[2], dur: "vo:2-3" },
  ],
  audio: {
    voiceover: { kind: "tts", voice_id: "voice_uz_1", text: VO_TEXT, language: "uz" },
    music: {
      kind: "music",
      prompt: "upbeat",
      length: "match_video",
      duck_under: "voiceover",
      duck_db: -12,
    },
    sfx: [{ id: "whoosh", prompt: "fast whoosh", duration_s: 0.8, at: "hook.end" }],
    captions: { from: "voiceover", style: "karaoke_bold", max_words: 3 },
  },
};

let t: TestApp;
let el: FakeEleven;
let s: McpSession;
let cookie: string;
let projectId: string;
let agent: FakeAgent;

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  cookie = await login(t, "aj@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "aj@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(
    t.app.hub,
    { userId: user!.id, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
  agent.storage = t.app.storage;
  agent.connect();
  s = await mcpSession(t, "aj@x.uz");
  await t.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    payload: { api_key: VALID_KEY },
  });
});

afterEach(async () => {
  await t.close();
});

async function runJob(spec: unknown = SPEC) {
  await s.call("plan_write", { project_id: projectId, spec });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id as string;
  await t.app.jobs.idle();
  await t.app.audio.idle();
  return { id, status: (await s.call("job_status", { job_id: id, log_limit: 50 })).result.data };
}

describe("AUDIO holati", () => {
  it("voiceover → timing → musiqa video uzunligida → ducking, SFX, subtitr; fayllar panelda", async () => {
    const { id, status } = await runJob();
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
    const tasks = await t.db.db.select().from(audioTasks).where(eq(audioTasks.jobId, id));
    expect(tasks.map((task) => task.kind).sort()).toEqual(["music", "sfx", "tts"]);
    expect(tasks.every((task) => task.status === "done" && task.localPath !== null)).toBe(true);
    for (const task of tasks) expect(agent.files.get(task.localPath!)).toBe(task.sha256);

    const rows = await t.db.db.select().from(ops).where(eq(ops.jobId, id));
    const op = (opId: string) =>
      rows.find((row) => row.opId === opId)?.params as Record<string, unknown>;
    const vo = tasks.find((task) => task.kind === "tts")!;
    // Sahnalar gaplar bo'yicha: hook = 1-gap (+ pauza), main comp = voiceover + dum.
    const hook = op("hook.comp");
    const main = op("aes.main");
    expect(hook.dur).toBeGreaterThan(0.8);
    expect(main.dur as number).toBeCloseTo((vo.durationMs ?? 0) / 1000 + 0.1, 0);
    // Musiqa aynan video uzunligida generatsiya qilingan (match_video).
    const music = tasks.find((task) => task.kind === "music")!;
    expect((music.params as { music_length_ms: number }).music_length_ms).toBe(
      Math.round((main.dur as number) * 1000),
    );
    expect(op("aes.music")).toMatchObject({ item: "audio.music", dur: main.dur });
    expect(op("aes.duck")).toMatchObject({
      music_layer: "aes.music",
      voice_layer: "aes.vo",
      amount_db: -12,
    });
    expect(op("aes.sfx.whoosh")).toMatchObject({ start: hook.dur });
    const captions = op("aes.captions") as { words: { text: string }[]; style: string };
    expect(captions.style).toBe("karaoke_bold");
    expect(captions.words.map((w) => w.text).join(" ")).toBe(VO_TEXT);
    expect(op("audio.vo")).toMatchObject({ file: vo.localPath, folder: "Audio" });
    expect(status.logs.map((l: { type: string }) => l.type)).toEqual(
      expect.arrayContaining(["audio.started", "audio.ready"]),
    );
  });

  it("qayta job (bir xil plan) — barcha audio keshdan, ElevenLabs'ga generatsiya so'rovi ketmaydi", async () => {
    const first = await runJob();
    await s.call("job_cancel", { job_id: first.id });
    await t.app.jobs.idle();
    const generations = el.generationCalls().length;
    const second = await runJob();
    expect(second.status.state).toBe("VERIFY");
    expect(el.generationCalls()).toHaveLength(generations);
    const tasks = await t.db.db.select().from(audioTasks).where(eq(audioTasks.jobId, second.id));
    expect(tasks.every((task) => task.cached && task.credits === 0)).toBe(true);
    const ready = second.status.logs.find((l: { type: string }) => l.type === "audio.ready");
    expect(ready.message).toContain("3 tasi keshdan");
  });

  it("kvota yetmasa → BLOCKED EL_QUOTA (ask_user), generatsiya boshlanmaydi", async () => {
    el.subscription.character_count = el.subscription.character_limit - 20;
    t.clock.advance(61_000);
    const { status } = await runJob();
    expect(status.state).toBe("BLOCKED");
    expect(status.error).toMatchObject({ code: "EL_QUOTA", details: { ask_user: true } });
    expect(el.generationCalls()).toHaveLength(0);
  });

  it("SFX xatosi — skipped, job davom etadi; voiceover xatosi — BLOCKED", async () => {
    el.failPaths.add("/v1/sound-generation");
    const { id, status } = await runJob();
    expect(status.state).toBe("VERIFY");
    const sfx = (await t.db.db.select().from(audioTasks).where(eq(audioTasks.jobId, id))).find(
      (task) => task.kind === "sfx",
    )!;
    expect(sfx.status).toBe("skipped");
    expect(status.logs.map((l: { type: string }) => l.type)).toContain("audio.skipped_item");
    await s.call("job_cancel", { job_id: id });
    await t.app.jobs.idle();

    el.failPaths.add("/v1/text-to-speech/voice_uz_1/with-timestamps");
    const changed = {
      ...SPEC,
      audio: {
        ...SPEC.audio,
        voiceover: { ...SPEC.audio.voiceover, text: "Boshqa matn. Ikki. Uch." },
      },
    };
    const blocked = await runJob(changed);
    expect(blocked.status).toMatchObject({
      state: "BLOCKED",
      error: { code: "EL_BAD_PARAMS", details: { role: "voiceover" } },
    });
  });

  it("audio yo'q spec — AUDIO skipped (oldingi oqim o'zgarmagan)", async () => {
    const { status } = await runJob(THREE_SCENES);
    expect(status.state).toBe("VERIFY");
    expect(status.logs.map((l: { type: string }) => l.type)).toContain("audio.skipped");
  });
});
