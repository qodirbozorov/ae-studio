/**
 * P3.08: report_get (MCP), panel Tarix endpointlari (qurilma tokeni), Claude indikatori (`claude.status`).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { issueToken } from "../src/auth/tokens";
import { devices, projects, users } from "../src/db/schema";
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
let deviceToken: string;
let userId: string;

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "hist@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "hist@x.uz"));
  userId = user!.id;
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId, deviceId: device!.id, name: "reel", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  deviceToken = (
    await issueToken(t.db.db, {
      kind: "device",
      ttlMs: null,
      now: t.clock.now,
      userId,
      deviceId: device!.id,
    })
  ).token;
  agent = new FakeAgent(
    t.app.hub,
    { userId, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
});

afterEach(async () => {
  await t.close();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

async function doneJob(): Promise<string> {
  await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
  await t.app.jobs.idle();
  await s.call("verify_approve", { job_id: id });
  await t.app.jobs.idle();
  return id;
}

describe("Claude indikatori", () => {
  it("hello'da ulanmagan; MCP chaqiruvidan keyin linked + last_seen", async () => {
    agent.connect();
    await settle();
    expect(agent.ofType("claude.status").at(-1)).toMatchObject({
      linked: false,
      last_seen_at: null,
    });

    s = await mcpSession(t, "hist@x.uz");
    await s.call("devices_list");
    await settle();
    expect(agent.ofType("claude.status").at(-1)).toMatchObject({
      linked: true,
      last_seen_at: t.clock.now.toISOString(),
    });
    // 30 s ichida qayta yuborilmaydi.
    const count = agent.ofType("claude.status").length;
    await s.call("devices_list");
    await settle();
    expect(agent.ofType("claude.status")).toHaveLength(count);
  });
});

describe("report_get va Tarix", () => {
  beforeEach(async () => {
    agent.connect();
    s = await mcpSession(t, "hist@x.uz");
  });

  it("report_get: REPORT'gacha xato, keyin markdown + video", async () => {
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
    await t.app.jobs.idle();
    const early = await s.call("report_get", { job_id: id });
    expect(early.result.error).toMatchObject({ code: "JOB_BAD_ACTION" });
    await s.call("verify_approve", { job_id: id });
    await t.app.jobs.idle();
    const report = await s.call("report_get", { job_id: id });
    expect(report.result.data).toMatchObject({
      outcome: "success",
      aep_path: "reel_v001.aep",
      renders: [expect.objectContaining({ local_path: "out/reel_v1_v001.mp4" })],
    });
    expect(report.result.data.markdown).toContain("Tahrir qo'llanmasi");
  });

  it("panel: joblar ro'yxati, hisobot, qayta render (qurilma tokeni bilan)", async () => {
    const id = await doneJob();
    const auth = { authorization: `Bearer ${deviceToken}` };
    const list = await t.app.inject({ url: "/api/agent/jobs", headers: auth });
    expect(list.json().data).toEqual([
      expect.objectContaining({
        id,
        project_name: "reel",
        state: "DONE",
        aep_path: "reel_v001.aep",
        renders: [expect.objectContaining({ status: "done" })],
      }),
    ]);
    const report = await t.app.inject({ url: `/api/agent/jobs/${id}/report`, headers: auth });
    expect(report.json().data.markdown).toContain("reel_v001.aep");

    const rerender = await t.app.inject({
      method: "POST",
      url: `/api/agent/jobs/${id}/render`,
      headers: auth,
      payload: { preset: "h264_hq" },
    });
    expect(rerender.json()).toMatchObject({ ok: true, data: { started: true } });
    await t.app.jobs.idle();
    expect(agent.ofType("render.request").map((m) => m.preset)).toEqual(["h264_social", "h264_hq"]);

    const bad = await t.app.inject({
      method: "POST",
      url: `/api/agent/jobs/${id}/render`,
      headers: auth,
      payload: { preset: "yoq" },
    });
    expect(bad.statusCode).toBe(400);
    const noAuth = await t.app.inject({ url: "/api/agent/jobs" });
    expect(noAuth.statusCode).toBe(401);
  });

  it("boshqa qurilma begona job'ni ko'rmaydi", async () => {
    const id = await doneJob();
    const [other] = await t.db.db
      .insert(devices)
      .values({ userId, name: "Other", os: "mac" })
      .returning();
    const otherToken = (
      await issueToken(t.db.db, {
        kind: "device",
        ttlMs: null,
        now: t.clock.now,
        userId,
        deviceId: other!.id,
      })
    ).token;
    const auth = { authorization: `Bearer ${otherToken}` };
    expect((await t.app.inject({ url: "/api/agent/jobs", headers: auth })).json().data).toEqual([]);
    const report = await t.app.inject({ url: `/api/agent/jobs/${id}/report`, headers: auth });
    expect(report.statusCode).toBe(404);
  });
});
