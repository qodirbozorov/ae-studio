/**
 * P3.05: qurish toollari MCP orqali (soxta panel): preflight, build_start (+dry_run), job_status/resume/cancel/list.
 */
import { makeError } from "@aes/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { assets, devices, jobs, projects, users } from "../src/db/schema";
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
  await login(t, "build@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "build@x.uz"));
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
  s = await mcpSession(t, "build@x.uz");
});

afterEach(async () => {
  await t.close();
});

async function seedAssets(list = ASSETS, status: "ok" | "corrupt" = "ok") {
  for (const asset of list) {
    await t.db.db.insert(assets).values({
      projectId,
      key: asset.key,
      localPath: asset.local_path,
      kind: asset.kind,
      meta: asset.meta,
      hash: `h_${asset.key}`,
      status,
    });
  }
}

async function status(jobId: string) {
  await t.app.jobs.idle();
  return (await s.call("job_status", { job_id: jobId })).result.data;
}

describe("preflight va dry_run", () => {
  it("missing[] (unknown/corrupt) va tayyor holat", async () => {
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    await seedAssets(ASSETS.slice(0, 1));
    await seedAssets(ASSETS.slice(2), "corrupt");
    const bad = await s.call("preflight", { project_id: projectId });
    expect(bad.result.data).toMatchObject({
      ready: false,
      missing: [
        { ref: "asset:photo_02", reason: "unknown" },
        { ref: "asset:ding", reason: "corrupt" },
      ],
    });
    expect(bad.result.data.error.code).toMatch(/SPEC_UNKNOWN_ASSET|ASSET_/);

    await t.db.db.delete(assets).where(eq(assets.projectId, projectId));
    await seedAssets();
    const good = await s.call("preflight", { project_id: projectId });
    expect(good.result.data).toMatchObject({
      ready: true,
      missing: [],
      error: null,
      aep_path: "reel_v001.aep",
      duration_s: 9.5,
      key_times: expect.any(Array),
    });
    expect(good.result.data.ops).toBeGreaterThan(20);
    expect(good.result.data.estimate_s).toBeGreaterThan(5);
  });

  it("dry_run job yaratmaydi; plan yo'q → SYS_NOT_FOUND", async () => {
    expect(
      (await s.call("build_start", { project_id: projectId, dry_run: true })).result.error.code,
    ).toBe("SYS_NOT_FOUND");
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    await seedAssets();
    const dry = await s.call("build_start", { project_id: projectId, dry_run: true });
    expect(dry.result.data).toMatchObject({
      dry_run: true,
      credits: 0,
      ops_by_type: { "project.save": 4 },
    });
    expect(await t.db.db.select().from(jobs)).toEqual([]);
  });
});

describe("build_start va job boshqaruvi", () => {
  it("job → VERIFY: progress 100%, aep yo'li, next_step; ikkinchi job → JOB_ACTIVE", async () => {
    agent.connect();
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    const started = await s.call("build_start", { project_id: projectId });
    expect(started.result).toMatchObject({ ok: true, data: { state: "CHECK" } });
    const jobId = started.result.data.id;
    const view = await status(jobId);
    expect(view).toMatchObject({
      state: "VERIFY",
      aep_path: "reel_v001.aep",
      progress: { percent: 100 },
      next_step: expect.stringContaining("frames_capture"),
    });
    expect(view.logs.length).toBeGreaterThan(3);
    expect(view.logs.every((l: { level: string }) => l.level !== "debug")).toBe(true);

    const again = await s.call("build_start", { project_id: projectId });
    expect(again.result.error.code).toBe("JOB_ACTIVE");

    const list = await s.call("job_list", { project_id: projectId });
    expect(list.result.data).toEqual([expect.objectContaining({ id: jobId, state: "VERIFY" })]);

    const cancelled = await s.call("job_cancel", { job_id: jobId });
    expect(cancelled.result.ok).toBe(true);
    expect(await status(jobId)).toMatchObject({ state: "DONE", outcome: "cancelled" });
  });

  it("BLOCKED → job_resume davom ettiradi; WAITING_AGENT'da resume tushuntiradi", async () => {
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    const waiting = (await s.call("build_start", { project_id: projectId })).result.data.id;
    expect(await status(waiting)).toMatchObject({ state: "WAITING_AGENT" });
    expect((await s.call("job_resume", { job_id: waiting })).result.error.code).toBe(
      "ENV_AGENT_OFFLINE",
    );
    await s.call("job_cancel", { job_id: waiting });
    await t.app.jobs.idle();

    agent.connect();
    let fails = 1;
    agent.onOp = (op) =>
      op.op_id === "cta.comp" && fails-- > 0 ? makeError("AE_SCRIPT_ERROR", "x") : "ok";
    const jobId = (await s.call("build_start", { project_id: projectId })).result.data.id;
    const blocked = await status(jobId);
    expect(blocked).toMatchObject({ state: "BLOCKED", error: { code: "AE_SCRIPT_ERROR" } });
    expect(blocked.next_step).toContain("job_resume");
    await s.call("job_resume", { job_id: jobId });
    expect(await status(jobId)).toMatchObject({ state: "VERIFY" });
    expect((await s.call("job_resume", { job_id: jobId })).result.error.code).toBe(
      "JOB_BAD_ACTION",
    );
  });

  it("begona job → SYS_NOT_FOUND", async () => {
    await login(t, "begona@x.uz");
    const other = await mcpSession(t, "begona@x.uz");
    agent.connect();
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    const jobId = (await s.call("build_start", { project_id: projectId })).result.data.id;
    await t.app.jobs.idle();
    expect((await other.call("job_status", { job_id: jobId })).result.error.code).toBe(
      "SYS_NOT_FOUND",
    );
    expect((await other.call("job_cancel", { job_id: jobId })).result.error.code).toBe(
      "SYS_NOT_FOUND",
    );
    expect((await other.call("job_list")).result.data).toEqual([]);
  });
});
