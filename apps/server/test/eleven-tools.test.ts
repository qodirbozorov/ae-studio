/**
 * P4.05–P4.08: ElevenLabs MCP toollari (soxta API + soxta panel).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { assets, devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

let t: TestApp;
let el: FakeEleven;
let s: McpSession;
let cookie: string;
let projectId: string;
let agent: FakeAgent;

const AUDIO_SPEC = {
  ...THREE_SCENES,
  audio: {
    voiceover: { kind: "tts", voice_id: "voice_uz_1", text: "Salom. Bu sinov.", language: "uz" },
    music: { kind: "music", prompt: "upbeat", length: "match_video", duck_under: "voiceover" },
    sfx: [{ id: "whoosh", prompt: "fast whoosh", duration_s: 0.8, at: "hook.end" }],
  },
};

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
    audioOptions: { dubPoll: { sleep: async () => {}, pollMs: 1 } },
  });
  cookie = await login(t, "tools-el@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "tools-el@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(t.app.hub, { userId: user!.id, deviceId: device!.id }, { root: "D:/r" });
  agent.connect();
  s = await mcpSession(t, "tools-el@x.uz");
});

afterEach(async () => {
  await t.close();
});

/** THREE_SCENES fixture'idagi assetlar. */
async function seedSceneAssets() {
  await t.db.db.insert(assets).values([
    {
      projectId,
      key: "clip_01",
      localPath: "source/clip_01.mp4",
      kind: "video",
      hash: "a",
      status: "ok",
      meta: { width: 1920, height: 1080, duration: 8 },
    },
    {
      projectId,
      key: "photo_02",
      localPath: "source/photo_02.jpg",
      kind: "image",
      hash: "b",
      status: "ok",
      meta: { width: 1000, height: 1500 },
    },
    {
      projectId,
      key: "ding",
      localPath: "audio/ding.wav",
      kind: "audio",
      hash: "c",
      status: "ok",
      meta: { duration: 1 },
    },
  ]);
}

const setKey = () =>
  t.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    payload: { api_key: VALID_KEY },
  });

describe("P4.05: TTS, ovozlar, modellar, talaffuz, hisob, narx", () => {
  it("kalitsiz → EL_AUTH; el_usage", async () => {
    expect((await s.call("el_usage")).result.error.code).toBe("EL_AUTH");
    expect((await s.call("el_voices")).result.error.code).toBe("EL_AUTH");
    await setKey();
    expect((await s.call("el_usage")).result.data).toMatchObject({
      tier: "creator",
      remaining: 99_000,
    });
  });

  it("el_tts: natija va so'z vaqtlari, loyihaga yetkaziladi; qayta — kesh", async () => {
    await setKey();
    const res = await s.call("el_tts", {
      text: "Salom dunyo.",
      voice_id: "voice_uz_1",
      language: "uz",
      project_id: projectId,
    });
    expect(res.result.data.task).toMatchObject({
      kind: "tts",
      status: "done",
      cached: false,
      credits: 12,
    });
    expect(el.calls.at(-1)!.json).toMatchObject({ model_id: "eleven_v4", language_code: "uz" });
    await t.app.audio.idle();
    const status = await s.call("audio_tasks_status", { task_ids: [res.result.data.task.id] });
    expect(status.result.data[0].local_path).toMatch(/^audio\/tts_/);
    const again = await s.call("el_tts", {
      text: "Salom dunyo.",
      voice_id: "voice_uz_1",
      language: "uz",
      project_id: projectId,
    });
    expect(again.result.data.task).toMatchObject({ cached: true, credits: 0 });
  });

  it("el_pronunciation → el_tts lug'at bilan; noma'lum lug'at", async () => {
    await setKey();
    expect(
      (await s.call("el_tts", { text: "AE", voice_id: "v", pronunciation: ["yoq"] })).result.error
        .code,
    ).toBe("SYS_NOT_FOUND");
    const dict = await s.call("el_pronunciation", {
      slug: "brand-uz",
      rules: [
        { word: "AE Studio", alias: "Ey-I Studio" },
        { word: "Toshkent", phoneme: "tɒʃˈkent" },
      ],
    });
    expect(dict.result.data).toMatchObject({ slug: "brand-uz", rules: 2, el_id: "dict_1" });
    expect(el.calls.at(-1)!.json!.rules).toEqual([
      { type: "alias", string_to_replace: "AE Studio", alias: "Ey-I Studio" },
      { type: "phoneme", string_to_replace: "Toshkent", phoneme: "tɒʃˈkent", alphabet: "ipa" },
    ]);
    await s.call("el_tts", { text: "AE Studio", voice_id: "v", pronunciation: ["brand-uz"] });
    expect(el.calls.at(-1)!.json!.pronunciation_dictionary_locators).toEqual([
      { pronunciation_dictionary_id: "dict_1", version_id: "ver_1" },
    ]);
    expect((await s.call("el_pronunciation")).result.data[0].slug).toBe("brand-uz");
  });

  it("el_voices, el_models (o'zbekcha)", async () => {
    await setKey();
    const voices = await s.call("el_voices", { search: "Aziz" });
    expect(voices.result.data[0]).toMatchObject({ voice_id: "voice_uz_1", name: "Aziz" });
    const models = await s.call("el_models", { language: "uz" });
    expect(models.result.data.models.map((m: { model_id: string }) => m.model_id)).toEqual([
      "eleven_v4",
    ]);
  });

  it("el_estimate (plan va items), kvota oshsa ask_user; dry_run'da kredit", async () => {
    await setKey();
    await s.call("plan_write", { project_id: projectId, spec: AUDIO_SPEC });
    const est = await s.call("el_estimate", { project_id: projectId });
    expect(est.result.data.items.map((i: { kind: string }) => i.kind)).toEqual([
      "tts",
      "music",
      "sfx",
    ]);
    expect(est.result.data).toMatchObject({ fits: true, approximate: true, remaining: 99_000 });
    expect(est.result.data.total).toBe(16 + 95 + 32);

    el.subscription.character_count = 99_990;
    t.clock.advance(61_000);
    const over = await s.call("el_estimate", {
      items: [{ kind: "tts", params: { text: "x".repeat(50) } }],
    });
    expect(over.result.data).toMatchObject({ fits: false, ask_user: true });

    await seedSceneAssets();
    const dry = await s.call("build_start", { project_id: projectId, dry_run: true });
    expect(dry.result.data.credits).toBe(143);
    expect(dry.result.data.audio.items).toHaveLength(3);
  });
});

describe("P4.06: dialogue, SFX, music, music plan", () => {
  it("vazifalar va composition plan", async () => {
    await setKey();
    const dialogue = await s.call("el_dialogue", {
      lines: [
        { voice_id: "a", text: "Salom!" },
        { voice_id: "b", text: "Va alaykum." },
      ],
      project_id: projectId,
    });
    expect(dialogue.result.data.task).toMatchObject({ kind: "dialogue", status: "done" });
    const sfx = await s.call("el_sfx", {
      prompt: "door knock",
      duration_s: 1.2,
      project_id: projectId,
    });
    expect(sfx.result.data.task).toMatchObject({ kind: "sfx", duration_s: 1.2 });
    const plan = await s.call("el_music_plan", { prompt: "calm piano", duration_s: 20 });
    expect(plan.result.data.plan.sections).toHaveLength(2);
    const music = await s.call("el_music", {
      composition_plan: plan.result.data.plan,
      project_id: projectId,
    });
    expect(music.result.data.task).toMatchObject({ kind: "music", duration_s: 20 });
    const simple = await s.call("el_music", {
      prompt: "upbeat",
      duration_s: 12,
      instrumental: true,
    });
    expect(simple.result.data.task.duration_s).toBe(12);
    expect(el.calls.at(-1)!.json).toMatchObject({
      music_length_ms: 12_000,
      force_instrumental: true,
    });
    const both = await s.call("el_music", { prompt: "x", composition_plan: plan.result.data.plan });
    expect(both.result.error.code).toBe("SYS_BAD_REQUEST");
  });
});

describe("P4.07–P4.08: kirish audiosi talab qiladigan toollar", () => {
  beforeEach(async () => {
    await setKey();
    await t.db.db.insert(assets).values([
      {
        projectId,
        key: "interview",
        localPath: "source/interview.mp4",
        kind: "video",
        hash: "h1",
        status: "ok",
        meta: { duration: 30 },
      },
      {
        projectId,
        key: "photo",
        localPath: "source/photo.jpg",
        kind: "image",
        hash: "h2",
        status: "ok",
      },
    ]);
    agent.storage = t.app.storage;
  });

  it("STT → transcript_get → transcript_edit; alignment; isolation", async () => {
    const stt = await s.call("el_stt", {
      project_id: projectId,
      key: "interview",
      language: "uz",
      diarize: true,
    });
    expect(stt.result.data.task).toMatchObject({ kind: "stt", status: "done" });
    expect(agent.extractions).toEqual(["source/interview.mp4"]);
    expect(el.calls.at(-1)!.fields).toMatchObject({ language_code: "uz", diarize: "true" });
    const id = stt.result.data.task.id;
    const transcript = await s.call("transcript_get", { task_id: id });
    expect(transcript.result.data).toMatchObject({ text: "Salom dunyo bu sinov", edited: false });
    expect(transcript.result.data.words).toHaveLength(4);
    const edited = await s.call("transcript_edit", {
      task_id: id,
      words: [{ index: 1, text: "Dunyo!" }],
    });
    expect(edited.result.data).toMatchObject({ text: "Salom Dunyo! bu sinov", edited: true });
    const again = await s.call("transcript_get", { task_id: id });
    expect(again.result.data.words[1]).toMatchObject({ text: "Dunyo!", start: 0.5 });
    const full = await s.call("transcript_edit", { task_id: id, text: "Bir ikki uch to'rt" });
    expect(full.result.data.words.map((w: { text: string }) => w.text)).toEqual([
      "Bir",
      "ikki",
      "uch",
      "to'rt",
    ]);
    const bad = await s.call("transcript_edit", { task_id: id, text: "faqat ikki" });
    expect(bad.result.error.code).toBe("SYS_BAD_REQUEST");

    const align = await s.call("el_align", {
      project_id: projectId,
      key: "interview",
      text: "Salom dunyo",
    });
    expect(align.result.data.task).toMatchObject({ kind: "align", status: "done" });
    const iso = await s.call("el_isolate", { project_id: projectId, key: "interview" });
    expect(iso.result.data.task).toMatchObject({ kind: "isolate", status: "done" });
    expect(
      (await s.call("el_stt", { project_id: projectId, key: "photo" })).result.error.code,
    ).toBe("ASSET_UNSUPPORTED");
  });

  it("voice changer, dubbing (poll), voice design (+saqlash), klon faqat rozilik bilan", async () => {
    const vc = await s.call("el_voice_change", {
      project_id: projectId,
      key: "interview",
      voice_id: "voice_uz_1",
    });
    expect(vc.result.data.task).toMatchObject({ kind: "voice_change", status: "done" });
    el.dubbingPolls = 2;
    const dub = await s.call("el_dub", {
      project_id: projectId,
      key: "interview",
      target_lang: "en",
    });
    expect(dub.result.data.task).toMatchObject({
      kind: "dub",
      status: "done",
      result: { dubbing_id: expect.any(String) },
    });

    const design = await s.call("el_voice_design", {
      description: "Yosh iliq ayol ovozi, o'zbekcha",
    });
    expect(design.result.data.task.result.previews).toHaveLength(2);
    const saved = await s.call("el_voice_design", {
      description: "Yosh iliq ayol ovozi, o'zbekcha",
      save: { generated_voice_id: "gen_2", name: "Malika" },
    });
    expect(saved.result.data).toMatchObject({ voice_id: "designed_gen_2" });

    const noConsent = await s.call("el_voice_clone", {
      project_id: projectId,
      keys: ["interview"],
      name: "Mijoz",
      consent: false,
    });
    expect(noConsent.isError).toBe(true);
    const clone = await s.call("el_voice_clone", {
      project_id: projectId,
      keys: ["interview"],
      name: "Mijoz",
      consent: true,
    });
    expect(clone.result.data).toMatchObject({ voice_id: "cloned_1" });
    const audit = await t.app.inject({ url: "/api/audit", headers: { cookie } });
    expect(audit.json().data.map((r: { action: string }) => r.action)).toContain(
      "mcp.el_voice_clone",
    );
  });
});
