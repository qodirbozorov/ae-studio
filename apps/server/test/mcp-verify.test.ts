/**
 * P3.06: VERIFY toollari — frames_capture, verify_approve, verify_patch (3 ta o'tadi, 4-chisi LOOP_PATCH_LIMIT).
 */
import { makeError } from "@aes/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, projects, users } from "../src/db/schema";
import { sampleTimes } from "../src/mcp/tools/verify";
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
  await login(t, "verify@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "verify@x.uz"));
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
  agent.onOp = (op) =>
    op.op === "frames.capture"
      ? {
          info: {
            files: (op.params as { times: number[]; dir: string }).times.map((time, i) => ({
              time,
              path: `${(op.params as { dir: string }).dir}/frame_0${i + 1}.png`,
            })),
          },
        }
      : "ok";
  agent.connect();
  s = await mcpSession(t, "verify@x.uz");
});

afterEach(async () => {
  await t.close();
});

async function verifyJob(): Promise<string> {
  await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
  const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
  await t.app.jobs.idle();
  expect((await s.call("job_status", { job_id: id })).result.data.state).toBe("VERIFY");
  return id;
}

async function state(id: string) {
  await t.app.jobs.idle();
  return (await s.call("job_status", { job_id: id })).result.data;
}

describe("sampleTimes", () => {
  it("chegaradan ko'p bo'lsa teng oraliqda tanlaydi", () => {
    expect(sampleTimes([1, 2, 3], 8)).toEqual([1, 2, 3]);
    expect(sampleTimes([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([0, 3, 6, 9]);
  });
});

describe("frames_capture", () => {
  it("kalit vaqtlardagi kadrlar rasm sifatida; job fayli ochiladi; job log'iga yoziladi", async () => {
    const id = await verifyJob();
    const res = await s.call("frames_capture", { job_id: id, max_px: 256 });
    expect(res.result).toMatchObject({ ok: true, data: { aep_path: "reel_v001.aep" } });
    const frames = res.result.data.frames;
    expect(frames.length).toBeGreaterThan(2);
    expect(frames.length).toBeLessThanOrEqual(8);
    expect(res.images).toHaveLength(frames.length);
    expect(res.images[0]!.mimeType).toBe("image/jpeg");
    expect(agent.previews).toEqual(frames.map((f: { path: string }) => f.path));

    const runs = agent.ofType("op.run").map((m) => m.op);
    const open = runs.find((op) => op.op_id.startsWith("verify.open."))!;
    expect(open.params).toEqual({ path: "reel_v001.aep" });
    const capture = runs.find((op) => op.op === "frames.capture")!;
    expect(capture.params).toMatchObject({
      comp: "aes.main",
      dir: expect.stringMatching(/^frames\//),
    });

    const custom = await s.call("frames_capture", { job_id: id, times: [1.5] });
    expect(custom.result.data.frames).toEqual([expect.objectContaining({ time: 1.5 })]);

    const events = await t.app.inject({ url: `/api/jobs/${id}/events` });
    expect(events.statusCode).toBe(401);
    const status = await state(id);
    expect(status.logs.some((l: { type: string }) => l.type === "verify.frames")).toBe(true);
  });

  it("VERIFY bo'lmagan job va offline panel", async () => {
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    agent.disconnect();
    const id = (await s.call("build_start", { project_id: projectId })).result.data.id;
    await t.app.jobs.idle();
    expect((await s.call("frames_capture", { job_id: id })).result.error.code).toBe(
      "JOB_BAD_ACTION",
    );
  });
});

describe("contact_sheet (P6.02)", () => {
  it("auto vaqtlar → bitta grid JPEG, vaqt yozuvlari, ish papkasiga ham saqlanadi", async () => {
    const id = await verifyJob();
    const res = await s.call("contact_sheet", { job_id: id });
    expect(res.result).toMatchObject({ ok: true, data: { aep_path: "reel_v001.aep" } });
    expect(res.images).toHaveLength(1);
    const frames = res.result.data.frames;
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.length).toBeLessThanOrEqual(6);
    expect(res.result.data.sheet_path).toMatch(/^frames\/.+\/contact_sheet\.jpg$/);
    const sheet = agent.sheets.at(-1)!;
    expect(sheet.files).toEqual(frames.map((f: { path: string }) => f.path));
    expect(sheet.labels[0]).toMatch(/^\d+\.\d\d s$/);
    expect(sheet.cols).toBe(Math.min(3, frames.length));

    const big = await s.call("contact_sheet", { job_id: id, times: [0.5, 1, 1.5, 2], grid: "2x1" });
    expect(big.result.data.frames).toHaveLength(2);
    expect(big.result.data.grid).toBe("2x1");
  });

  it("AE javob bermasa → AE_MODAL_SUSPECTED; comp yo'q → FRAME_CAPTURE_FAILED{comp_not_found}", async () => {
    const id = await verifyJob();
    const base = agent.onOp;
    agent.onOp = (op) =>
      op.op === "ping" && op.op_id.startsWith("verify.ping.")
        ? makeError("AE_TIMEOUT", "jim")
        : base(op);
    expect((await s.call("contact_sheet", { job_id: id })).result.error).toMatchObject({
      code: "AE_MODAL_SUSPECTED",
      retryable: true,
    });
    agent.onOp = (op) =>
      op.op === "frames.capture" ? makeError("AE_NOT_FOUND", "Comp topilmadi: aes.main") : base(op);
    expect((await s.call("frames_capture", { job_id: id })).result.error).toMatchObject({
      code: "FRAME_CAPTURE_FAILED",
      details: { reason: "comp_not_found" },
    });
  });
});

describe("verify_approve / verify_patch", () => {
  it("sukut: approve render'siz → DONE; ruxsatsiz render rad etiladi", async () => {
    const id = await verifyJob();
    expect((await s.call("verify_approve", { job_id: id, render: true })).result.error.code).toBe(
      "RENDER_NOT_CONFIRMED",
    );
    expect((await s.call("verify_approve", { job_id: id })).result.ok).toBe(true);
    expect(await state(id)).toMatchObject({ state: "DONE", outcome: "success" });
    // Panelga render so'rovi yuborilmagan; hisobot AE timeline'iga yo'naltiradi.
    expect(agent.ofType("render.request")).toHaveLength(0);
    const report = await s.call("report_get", { job_id: id });
    expect(JSON.stringify(report.result.data)).toContain("Render: qilinmagan");
    expect(
      (await s.call("render_start", { job_id: id, user_confirmed: false })).result.error.code,
    ).toBe("RENDER_NOT_CONFIRMED");
  });

  it("approve (render: true, user_confirmed) → RENDER → REPORT → DONE", async () => {
    const id = await verifyJob();
    const res = await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true });
    expect(res.result.ok).toBe(true);
    expect(await state(id)).toMatchObject({ state: "DONE", outcome: "success" });
    expect(
      (await s.call("verify_approve", { job_id: id, render: true, user_confirmed: true })).result
        .error.code,
    ).toBe("JOB_BAD_ACTION");
  });

  it("3 ta patch o'tadi (har biri yangi .aep), 4-chisi LOOP_PATCH_LIMIT", async () => {
    const id = await verifyJob();
    for (let i = 1; i <= 3; i++) {
      const res = await s.call("verify_patch", {
        job_id: id,
        patch: [{ op: "replace", path: "/scenes/2/dur", value: 2.5 + i }],
        reason: `cta qisqa (${i})`,
      });
      expect(res.result.data).toMatchObject({ patch_count: i, patches_left: 3 - i });
      expect(await state(id)).toMatchObject({
        state: "VERIFY",
        plan_version: 1 + i,
        aep_path: `reel_v00${1 + i}.aep`,
      });
    }
    const fourth = await s.call("verify_patch", { job_id: id, spec: THREE_SCENES });
    expect(fourth.isError).toBe(true);
    expect(fourth.result.error).toMatchObject({
      code: "LOOP_PATCH_LIMIT",
      hint: expect.stringContaining("ask_user"),
    });
    const logs = (await state(id)).logs.map((l: { message: string }) => l.message);
    expect(logs.some((m: string) => m.includes("cta qisqa (3)"))).toBe(true);
  });

  it("noto'g'ri patch → SPEC_INVALID, patch soni oshmaydi; spec+patch birga → xato", async () => {
    const id = await verifyJob();
    const bad = await s.call("verify_patch", {
      job_id: id,
      patch: [{ op: "replace", path: "/scenes/2/dur", value: -5 }],
    });
    expect(bad.result.error.code).toBe("SPEC_INVALID");
    expect((await state(id)).patch_count).toBe(0);
    const both = await s.call("verify_patch", {
      job_id: id,
      spec: THREE_SCENES,
      patch: [{ op: "test", path: "/version", value: 1 }],
    });
    expect(both.result.error.code).toBe("SYS_BAD_REQUEST");
  });
});
