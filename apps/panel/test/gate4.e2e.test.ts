/**
 * P4.15 — Faza 4 gate (kod qismi): MCP orqali, haqiqiy server + agent + ffmpeg + ES3 bundle (mock AE) +
 * soxta ElevenLabs API (rasmiy shakllar, WAV audio):
 * 1) voiceover + karaoke subtitr + generatsiya qilingan musiqa (ducking) + SFX bilan video → render;
 * 2) mavjud video: isolate + transcribe + subtitr;
 * 3) kesh: qayta ishga tushirishda ElevenLabs generatsiya so'rovi yo'q;
 * 4) kvota oshsa ask_user.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { FakeEleven, VALID_KEY } from "../../server/test/helpers/fake-eleven";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { McpSession } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { createMockAE } from "./ae-mock";
import type { CompItem } from "./ae-mock";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

const exe = process.platform === "win32" ? ".exe" : "";
let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
  delete process.env.AES_FAKE_RENDER_S;
  delete process.env.AES_FAKE_FFMPEG;
});

const VO_TEXT = "Bugun uchta sir. Birinchisi oddiy! Obuna bo'ling.";

const REEL = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "vo_reel" },
  scenes: [
    {
      id: "hook",
      dur: "vo:0-1",
      transition_out: "fade",
      layers: [{ type: "media", src: "asset:clip_01", anim: "ken_burns_in" }],
    },
    {
      id: "body",
      dur: "vo:1-2",
      layers: [{ type: "media", src: "asset:photo", fit: "cover", anim: "fade_in" }],
    },
    { id: "cta", dur: "vo:2-3", layers: [{ type: "text", text: "Obuna bo'ling!", anim: "pop" }] },
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

const INTERVIEW = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "interview" },
  scenes: [{ id: "talk", dur: 2, layers: [{ type: "media", src: "asset:clip_01", fit: "cover" }] }],
  audio: {
    source_audio: { asset: "asset:clip_01", isolate: true, transcribe: true, language: "uz" },
    captions: { from: "source_audio", method: "stt", style: "bold_pop" },
  },
};

async function setup(el: FakeEleven) {
  const s = await start(undefined, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  t = s.app;
  const root = mkdtempSync(join(tmpdir(), "aes-gate4-")).replace(/\\/g, "/");
  makeSourceFolder(root);
  const ae = createMockAE({ realDisk: true });
  const p = await pairedAgent(s.app, s.base, undefined, "", ae);
  agent = p.agent;
  const ffmpegDir = findFfmpegDir() ?? null;
  p.agent.updateSettings({
    ffmpeg_dir: ffmpegDir,
    aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
  });
  process.env.AES_FAKE_FFMPEG = ffmpegDir === null ? "ffmpeg" : join(ffmpegDir, `ffmpeg${exe}`);
  await s.app.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie: p.cookie },
    payload: { api_key: VALID_KEY },
  });
  const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);
  const project = (await mcp.call("project_create", { root_path: root })).result.data;
  ae.files.set(`${project.root_path}/source/Clip 01.mp4`, {
    width: 1920,
    height: 1080,
    duration: 2,
    frameRate: 30,
    hasAudio: true,
  });
  ae.files.set(`${project.root_path}/source/Photo.png`, { width: 1000, height: 1500 });
  expect((await mcp.call("assets_scan", { project_id: project.id })).result.data.status).toBe(
    "done",
  );
  return { mcp, project, root, ae, cookie: p.cookie };
}

async function build(mcp: McpSession, projectId: string, spec: unknown) {
  expect((await mcp.call("plan_write", { project_id: projectId, spec })).result.ok).toBe(true);
  const pre = await mcp.call("preflight", { project_id: projectId });
  expect(pre.result.data.ready).toBe(true);
  const started = await mcp.call("build_start", { project_id: projectId });
  expect(started.result.ok, JSON.stringify(started.result.error)).toBe(true);
  const jobId = started.result.data.id as string;
  const verify = await eventually(
    () => mcp.call("job_status", { job_id: jobId, log_limit: 40 }),
    (res) => ["VERIFY", "BLOCKED"].includes(res.result.data.state),
    120_000,
  );
  return { jobId, status: verify.result.data };
}

async function approveAndRender(mcp: McpSession, projectId: string, jobId: string) {
  const timed = await mcp.call("preflight", { project_id: projectId });
  process.env.AES_FAKE_RENDER_S = String(timed.result.data.duration_s);
  await mcp.call("verify_approve", { job_id: jobId });
  const done = await eventually(
    () => mcp.call("job_status", { job_id: jobId }),
    (res) => ["DONE", "BLOCKED"].includes(res.result.data.state),
    120_000,
  );
  return { done: done.result.data, duration: timed.result.data.duration_s as number };
}

describe.skipIf(!FFMPEG_AVAILABLE)("Faza 4 gate: ElevenLabs bilan video", () => {
  it("voiceover + karaoke + musiqa (ducking) + SFX → render; qayta — keshdan; kvota → ask_user", async () => {
    const el = new FakeEleven();
    const { mcp, project, root, ae, cookie } = await setup(el);

    const { jobId, status } = await build(mcp, project.id, REEL);
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
    const tasks = (await mcp.call("audio_tasks_status", { job_id: jobId })).result.data;
    const est = await mcp.call("el_estimate", { project_id: project.id });
    expect(est.result.data).toMatchObject({ fits: true });
    expect(tasks.map((task: { kind: string }) => task.kind).sort()).toEqual([
      "music",
      "sfx",
      "tts",
    ]);
    for (const task of tasks) {
      expect(task.status).toBe("done");
      // ElevenLabs fayllari server storage'idan panelga yuklab olingan.
      expect(existsSync(join(root, task.local_path)), task.local_path).toBe(true);
    }

    // AE: voiceover, musiqa (ducking), SFX, subtitr asosiy comp'da.
    const main = ae.app.project.itemsList.find((i) => i.name === "vo_reel") as CompItem;
    const names = main.layersList.map((l) => l.name);
    expect(names).toEqual(
      expect.arrayContaining(["VOICEOVER", "MUSIC", "SFX whoosh", "CAPTION 1"]),
    );
    const music = main.layersList.find((l) => l.name === "MUSIC")!;
    const levels = music.property("ADBE Audio Group").property("ADBE Audio Levels");
    expect(levels.keys.length).toBeGreaterThan(2);
    const firstCaption = main.layersList.find((l) => l.name === "CAPTION 1")!;
    const words = firstCaption.property("ADBE Text Properties").property("ADBE Text Document").keys;
    expect(words.map((k) => (k.value as { text: string }).text)).toEqual([
      "BUGUN",
      "BUGUN UCHTA",
      "BUGUN UCHTA SIR.",
    ]);

    const frames = await mcp.call("frames_capture", { job_id: jobId, max_px: 256 });
    expect(frames.images.length).toBeGreaterThan(1);
    const { done, duration } = await approveAndRender(mcp, project.id, jobId);
    expect(done).toMatchObject({ state: "DONE", outcome: "success" });
    expect(existsSync(join(root, "out", "vo_reel_v001.mp4"))).toBe(true);
    expect(duration).toBeGreaterThan(3);

    // Kesh: yangi job bir xil plan bilan — ElevenLabs'ga generatsiya so'rovi yo'q.
    const before = el.generationCalls().length;
    const again = await build(mcp, project.id, REEL);
    expect(again.status.state).toBe("VERIFY");
    expect(el.generationCalls()).toHaveLength(before);
    const cached = (await mcp.call("audio_tasks_status", { job_id: again.jobId })).result.data;
    expect(
      cached.every(
        (task: { cached: boolean; credits: number }) => task.cached && task.credits === 0,
      ),
    ).toBe(true);
    await mcp.call("job_cancel", { job_id: again.jobId });
    await eventually(
      () => mcp.call("job_status", { job_id: again.jobId }),
      (res) => res.result.data.state === "DONE",
      60_000,
    );

    // Kvota: boshqa matn (yangi generatsiya) va qoldiq kam → BLOCKED EL_QUOTA, ask_user.
    el.subscription.character_count = el.subscription.character_limit - 10;
    // Kalitni qayta saqlash subscription keshini yangilaydi (aks holda 60 s kesh).
    await t!.app.inject({
      method: "PUT",
      url: "/api/settings/elevenlabs",
      headers: { cookie },
      payload: { api_key: VALID_KEY },
    });
    const pricey = {
      ...REEL,
      audio: {
        ...REEL.audio,
        voiceover: { ...REEL.audio.voiceover, text: "Yangi matn. Ikki gap. Uch." },
      },
    };
    const blocked = await build(mcp, project.id, pricey);
    expect(blocked.status.state).toBe("BLOCKED");
    expect(blocked.status.error).toMatchObject({ code: "EL_QUOTA", details: { ask_user: true } });
    const estimate = await mcp.call("el_estimate", { project_id: project.id });
    expect(estimate.result.data).toMatchObject({ fits: false, ask_user: true });
    expect(el.generationCalls()).toHaveLength(before);
  }, 300_000);

  it("mavjud video: isolate + transcribe + subtitr → render", async () => {
    const el = new FakeEleven();
    el.sttText = "Salom bu intervyu edi";
    const { mcp, project, root, ae } = await setup(el);
    const { jobId, status } = await build(mcp, project.id, INTERVIEW);
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
    const kinds = (await mcp.call("audio_tasks_status", { job_id: jobId })).result.data.map(
      (task: { kind: string }) => task.kind,
    );
    expect(kinds.sort()).toEqual(["isolate", "stt"]);
    expect(el.calls.find((c) => c.path === "/v1/speech-to-text")!.fields).toMatchObject({
      language_code: "uz",
    });

    const main = ae.app.project.itemsList.find((i) => i.name === "interview") as CompItem;
    const names = main.layersList.map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(["SOURCE (clean)", "CAPTION 1"]));
    const caption = main.layersList.find((l) => l.name === "CAPTION 1")!;
    const doc = caption.property("ADBE Text Properties").property("ADBE Text Document").value as {
      text: string;
    };
    expect(doc.text).toBe("SALOM BU INTERVYU EDI");

    const { done } = await approveAndRender(mcp, project.id, jobId);
    expect(done).toMatchObject({ state: "DONE" });
    expect(existsSync(join(root, "out", "interview_v001.mp4"))).toBe(true);
  }, 300_000);
});
