/**
 * P5.04: brand kit — brand_save/brands_list, PREFLIGHT'da AE shriftlari (fallback, AE_FONT_MISSING),
 * CHECK'da noma'lum brand va ovozsiz voiceover, AUDIO'da brand ovozi va musiqa uslubi.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { audioTasks, devices, ops, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/brand";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
  { key: "logo", local_path: "source/logo.png", kind: "image", meta: { width: 512, height: 512 } },
];

const ACME = {
  slug: "acme",
  name: "Acme",
  colors: { primary: "#1E40AF", accent: "#F59E0B", text: "#FAFAFA", background: "#0B1020" },
  fonts: {
    heading: { family: "Montserrat-Bold", fallback: ["Arial-BoldMT"] },
    body: { family: "Inter-Regular", fallback: ["ArialMT"] },
  },
  logo: "asset:logo",
  voice: { voice_id: "brand_voice_1" },
  music_style: "calm piano",
};

const SPEC = {
  version: 1,
  brand: "acme",
  format: { w: 1080, h: 1920, fps: 30 },
  output: { name: "brand" },
  scenes: [
    {
      id: "s1",
      dur: 3,
      template: "cta_outro",
      slots: { headline: "Obuna bo'ling" },
    },
    { id: "s2", dur: 2, layers: [{ id: "note", type: "text", text: "Rahmat" }] },
  ],
};

let t: TestApp;
let s: McpSession;
let projectId: string;
let agent: FakeAgent;
let el: FakeEleven;
let fonts: string[] | null;

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  const cookie = await login(t, "br@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "br@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "brand", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(
    t.app.hub,
    { userId: user!.id, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
  agent.storage = t.app.storage;
  fonts = ["Montserrat-Bold", "Inter-Regular"];
  agent.onOp = (op) => (op.op === "info" ? { info: { font_names: fonts } } : "ok");
  agent.connect();
  s = await mcpSession(t, "br@x.uz");
  await s.call("assets_scan", { project_id: projectId });
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

async function runJob(spec: unknown) {
  await s.call("plan_write", { project_id: projectId, spec });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id as string;
  await t.app.jobs.idle();
  await t.app.audio.idle();
  return { id, status: (await s.call("job_status", { job_id: id, log_limit: 50 })).result.data };
}

const opParams = async (jobId: string, opId: string) =>
  (await t.db.db.select().from(ops).where(eq(ops.jobId, jobId))).find((r) => r.opId === opId)
    ?.params as Record<string, unknown> | undefined;

describe("brand kit toollari", () => {
  it("brand_save (upsert) va brands_list", async () => {
    const saved = await s.call("brand_save", { brand: ACME });
    expect(saved.result.data).toMatchObject({ slug: "acme", captions: { style: "karaoke_bold" } });
    await s.call("brand_save", { brand: { ...ACME, name: "Acme 2" } });
    const list = (await s.call("brands_list", {})).result.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: "acme", name: "Acme 2" });
    const bad = await s.call("brand_save", { brand: { ...ACME, colors: { primary: "red" } } });
    expect(bad.result.ok).toBe(false);
  });
});

describe("brand kit build'da", () => {
  beforeEach(async () => {
    await s.call("brand_save", { brand: ACME });
  });

  it("shablon tokenlari, shriftlar, logo, fon — AE'dagi shriftlar bilan", async () => {
    const { id, status } = await runJob(SPEC);
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
    expect(await opParams(id, "s1.tpl.headline")).toMatchObject({
      style: { font: "Montserrat-Bold", color: "#FAFAFA" },
    });
    expect(await opParams(id, "s1.tpl.logo")).toMatchObject({ item: "asset.logo", scale: 0.28 });
    expect(await opParams(id, "s2.note")).toMatchObject({
      style: { font: "Inter-Regular", color: "#FAFAFA" },
    });
    expect(await opParams(id, "s2.comp")).toMatchObject({ bg: "#0B1020" });
    expect(agent.ran.some((opId) => opId.startsWith("preflight.info."))).toBe(true);
  });

  it("shrift yo'q → fallback; fallback ham yo'q → BLOCKED AE_FONT_MISSING", async () => {
    fonts = ["Montserrat-Bold", "ArialMT"];
    const first = await runJob(SPEC);
    expect(first.status.state).toBe("VERIFY");
    expect(await opParams(first.id, "s2.note")).toMatchObject({ style: { font: "ArialMT" } });
    await s.call("job_cancel", { job_id: first.id });
    await t.app.jobs.idle();

    fonts = ["Montserrat-Bold"];
    const second = await runJob(SPEC);
    expect(second.status).toMatchObject({
      state: "BLOCKED",
      error: { code: "AE_FONT_MISSING", details: { font: "Inter-Regular" } },
    });
    // MCP preflight ham panel orqali shriftlarni tekshiradi.
    const pre = await s.call("preflight", { project_id: projectId });
    expect(pre.result).toMatchObject({ ok: false, error: { code: "AE_FONT_MISSING" } });
  });

  it("noma'lum brand → CHECK'da SPEC_INVALID", async () => {
    const { status } = await runJob({ ...SPEC, brand: "yoq" });
    expect(status).toMatchObject({
      state: "BLOCKED",
      error: { code: "SPEC_INVALID", message: expect.stringContaining("/brand") },
    });
  });

  it("voiceover voice_id va musiqa prompt'siz → brand ovozi va musiqa uslubi", async () => {
    const spec = {
      ...SPEC,
      scenes: [{ id: "s1", dur: "vo:0-1", layers: [{ type: "text", text: "Salom" }] }],
      audio: {
        voiceover: { kind: "tts", text: "Salom dunyo.", language: "uz" },
        music: { kind: "music", length: "match_video" },
      },
    };
    const { id, status } = await runJob(spec);
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
    const tasks = await t.db.db.select().from(audioTasks).where(eq(audioTasks.jobId, id));
    expect(tasks.find((task) => task.kind === "tts")!.params).toMatchObject({
      voice_id: "brand_voice_1",
    });
    expect(tasks.find((task) => task.kind === "music")!.params).toMatchObject({
      prompt: "calm piano",
    });
  });

  it("brand'da ovoz yo'q va voice_id berilmagan → SPEC_INVALID", async () => {
    await s.call("brand_save", { brand: { ...ACME, voice: undefined } });
    const { status } = await runJob({
      ...SPEC,
      scenes: [{ id: "s1", dur: 2, layers: [{ type: "text", text: "Salom" }] }],
      audio: { voiceover: { kind: "tts", text: "Salom." } },
    });
    expect(status).toMatchObject({
      state: "BLOCKED",
      error: { code: "SPEC_INVALID", message: expect.stringContaining("voice_id") },
    });
  });
});
