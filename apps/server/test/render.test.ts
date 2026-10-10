/**
 * P3.07: RENDER holati (soxta panel) — gate (±1 kadr), xatolar, panel uzilishi, qayta render, MCP toollari.
 */
import { durationMatches, makeError } from "@aes/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, projects, renders, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/reel";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
  {
    key: "photo_02",
    local_path: "source/photo_02.jpg",
    kind: "image",
    meta: { width: 1000, height: 1500 },
  },
  { key: "ding", local_path: "audio/ding.wav", kind: "audio", meta: { duration: 1 } },
];

let t: TestApp;
let s: McpSession;
let agent: FakeAgent;
let projectId: string;

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "render@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "render@x.uz"));
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
  agent.connect();
  s = await mcpSession(t, "render@x.uz");
});

afterEach(async () => {
  await t.close();
});

async function toVerify(): Promise<string> {
  await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
  await t.app.jobs.idle();
  return id;
}

async function status(id: string) {
  await t.app.jobs.idle();
  return (await s.call("job_status", { job_id: id })).result.data;
}

describe("durationMatches (±1 kadr)", () => {
  it("chegaralar", () => {
    expect(durationMatches(9.5, 9.5, 30)).toBe(true);
    expect(durationMatches(9.533, 9.5, 30)).toBe(true);
    expect(durationMatches(9.6, 9.5, 30)).toBe(false);
    expect(durationMatches(9.46, 9.5, 25)).toBe(true);
  });
});

describe("RENDER holati", () => {
  it("approve → render.request (to'g'ri parametrlar) → renders done → hisobotda video", async () => {
    const id = await toVerify();
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    const done = await status(id);
    expect(done).toMatchObject({ state: "DONE", outcome: "success" });
    const request = agent.ofType("render.request")[0]!;
    expect(request).toMatchObject({
      job_id: id,
      project_path: "reel_v001.aep",
      comp: { op_id: "aes.main", name: "reel_v1" },
      out_base: "out/reel_v1_v001",
      preset: "h264_social",
      fps: 30,
      duration: 9.5,
    });
    expect(done.renders).toEqual([
      expect.objectContaining({
        status: "done",
        local_path: "out/reel_v1_v001.mp4",
        duration_s: 9.5,
        method: "aerender",
      }),
    ]);
  });

  it("davomiylik mos emas → BLOCKED RENDER_DURATION_MISMATCH → job_resume qayta render qiladi", async () => {
    const id = await toVerify();
    let first = true;
    agent.onRender = () => {
      if (first) {
        first = false;
        return { duration: 8 };
      }
      return "ok";
    };
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    const blocked = await status(id);
    expect(blocked).toMatchObject({
      state: "BLOCKED",
      prev_state: "RENDER",
      error: { code: "RENDER_DURATION_MISMATCH", details: { actual: 8, expected: 9.5 } },
    });
    await s.call("job_resume", { job_id: id });
    const done = await status(id);
    expect(done.state).toBe("DONE");
    expect(done.renders.map((r: { status: string }) => r.status).sort()).toEqual([
      "done",
      "failed",
    ]);
  });

  it("panel render xatosi → BLOCKED RENDER_FAILED", async () => {
    const id = await toVerify();
    agent.onRender = () => makeError("RENDER_FAILED", "aerender kodi 1");
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    expect((await status(id)).error.code).toBe("RENDER_FAILED");
  });

  it("render paytida panel uzilsa → WAITING_AGENT → ulanganda qayta render", async () => {
    const id = await toVerify();
    agent.onRender = () => {
      agent.disconnect();
      return "drop";
    };
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    expect(await status(id)).toMatchObject({ state: "WAITING_AGENT", prev_state: "RENDER" });
    agent.onRender = () => "ok";
    agent.connect();
    for (let i = 0; i < 100 && (await status(id)).state !== "DONE"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const done = await status(id);
    expect(done.state).toBe("DONE");
    const rows = await t.db.db.select().from(renders).where(eq(renders.jobId, id));
    expect(rows.map((r) => r.status).sort()).toEqual(["done", "failed"]);
  });
});

describe("MCP render_presets / render_start", () => {
  it("presetlar; qayta render faqat DONE job uchun, fonda; boshqa preset", async () => {
    const presets = await s.call("render_presets");
    expect(presets.result.data.map((p: { id: string }) => p.id)).toEqual([
      "h264_social",
      "h264_hq",
    ]);

    const id = await toVerify();
    expect(
      (await s.call("render_start", { job_id: id, user_confirmed: true })).result.error.code,
    ).toBe("JOB_BAD_ACTION");
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    await status(id);
    const again = await s.call("render_start", {
      job_id: id,
      preset: "h264_hq",
      user_confirmed: true,
    });
    expect(again.result).toMatchObject({ ok: true, data: { started: true } });
    const done = await status(id);
    expect(
      done.renders.map((r: { preset: string; status: string }) => `${r.preset}:${r.status}`).sort(),
    ).toEqual(["h264_hq:done", "h264_social:done"]);
    agent.disconnect();
    expect(
      (await s.call("render_start", { job_id: id, user_confirmed: true })).result.error.code,
    ).toBe("ENV_AGENT_OFFLINE");
  });
});

describe("format variantlari (P5.05)", () => {
  it("asosiy format va har variant alohida render; frames_capture variant comp'ida; qayta render hammasini", async () => {
    await s.call("plan_write", {
      project_id: projectId,
      spec: { ...THREE_SCENES, variants: ["1:1", "16:9"] },
    });
    const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
    await t.app.jobs.idle();
    const requests: { comp: string; out: string }[] = [];
    agent.onRender = (m) => {
      requests.push({ comp: m.comp.op_id, out: m.out_base });
      return "ok";
    };
    const frames = await s.call("frames_capture", { job_id: id, variant: "16:9", times: [1] });
    expect(frames.result.ok, JSON.stringify(frames.result)).toBe(true);
    expect(
      (await s.call("frames_capture", { job_id: id, variant: "9:16", times: [1] })).result.error
        .details.variants,
    ).toEqual(["1:1", "16:9"]);

    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    expect(await status(id)).toMatchObject({ state: "DONE", outcome: "success" });
    expect(requests).toEqual([
      { comp: "aes.main", out: "out/reel_v1_v001" },
      { comp: "aes.main.1x1", out: "out/reel_v1_1x1_v001" },
      { comp: "aes.main.16x9", out: "out/reel_v1_16x9_v001" },
    ]);
    const rows = await t.db.db.select().from(renders).where(eq(renders.jobId, id));
    expect(rows.map((r) => [r.variant, r.status, r.aepVersion]).sort()).toEqual(
      [
        [null, "done", 1],
        ["16x9", "done", 1],
        ["1x1", "done", 1],
      ].sort(),
    );

    requests.length = 0;
    expect((await s.call("render_start", { job_id: id, user_confirmed: true })).result.ok).toBe(
      true,
    );
    await t.app.jobs.idle();
    expect(requests.map((r) => r.comp)).toEqual(["aes.main", "aes.main.1x1", "aes.main.16x9"]);
  });

  it("variant render xatosi → BLOCKED; resume'da faqat qolgani render qilinadi", async () => {
    await s.call("plan_write", {
      project_id: projectId,
      spec: { ...THREE_SCENES, variants: ["16:9"] },
    });
    const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
    await t.app.jobs.idle();
    const comps: string[] = [];
    agent.onRender = (m) => {
      comps.push(m.comp.op_id);
      return m.comp.op_id === "aes.main.16x9" && comps.length === 2
        ? makeError("RENDER_FAILED", "disk to'la")
        : "ok";
    };
    await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    expect(await status(id)).toMatchObject({ state: "BLOCKED", error: { code: "RENDER_FAILED" } });
    await s.call("job_resume", { job_id: id });
    expect(await status(id)).toMatchObject({ state: "DONE", outcome: "success" });
    expect(comps).toEqual(["aes.main", "aes.main.16x9", "aes.main.16x9"]);
  });
});
