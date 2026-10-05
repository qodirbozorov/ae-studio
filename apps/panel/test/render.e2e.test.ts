/**
 * P3.07: RENDER e2e — haqiqiy server + agent + ffmpeg:
 * aerender (soxta skript) → oraliq .mov → ffmpeg (preset) → out/<nom>_v001.mp4, davomiylik gate'i;
 * zaxira: aerender yo'q → AE Render Queue (mock) → ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { McpSession } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { findAerender, uniquePath } from "../src/agent/render";
import { createMockAE } from "./ae-mock";
import type { MockAE } from "./ae-mock";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

const FAKE_AERENDER = join(__dirname, "fixtures", "fake-aerender.mjs");
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

const SPEC = {
  version: 1,
  format: { w: 320, h: 240, fps: 30 },
  output: { preset: "h264_social", name: "promo" },
  scenes: [
    { id: "a", dur: 1.5, layers: [{ type: "media", src: "asset:photo", fit: "cover" }] },
    { id: "b", dur: 1, layers: [{ type: "text", text: "Salom" }] },
  ],
};

async function setup(ae: MockAE, aerenderPath: string | null) {
  const s = await start();
  t = s.app;
  const root = mkdtempSync(join(tmpdir(), "aes-rend-")).replace(/\\/g, "/");
  makeSourceFolder(root);
  const p = await pairedAgent(s.app, s.base, undefined, root, ae);
  agent = p.agent;
  const ffmpegDir = findFfmpegDir() ?? null;
  p.agent.updateSettings({ ffmpeg_dir: ffmpegDir, aerender_path: aerenderPath });
  const project = await p.agent.openProject(root);
  ae.files.set(`${project.root_path}/source/Photo.png`, { width: 1000, height: 1500 });
  const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);
  await mcp.call("assets_scan", { project_id: project.id });
  process.env.AES_FAKE_FFMPEG = ffmpegDir === null ? "ffmpeg" : join(ffmpegDir, `ffmpeg${exe}`);
  return { mcp, project, root };
}

async function buildAndApprove(mcp: McpSession, projectId: string) {
  expect((await mcp.call("plan_write", { project_id: projectId, spec: SPEC })).result.ok).toBe(
    true,
  );
  const jobId = (await mcp.call("build_start", { project_id: projectId })).result.data.id as string;
  const verify = await eventually(
    () => mcp.call("job_status", { job_id: jobId }),
    (res) => ["VERIFY", "BLOCKED"].includes(res.result.data.state),
    60_000,
  );
  expect(verify.result.data.error).toBeNull();
  await mcp.call("verify_approve", { job_id: jobId });
  const done = await eventually(
    () => mcp.call("job_status", { job_id: jobId }),
    (res) => ["DONE", "BLOCKED"].includes(res.result.data.state),
    120_000,
  );
  return { jobId, status: done.result.data };
}

function probeDuration(file: string): number {
  const dir = findFfmpegDir();
  const ffprobe = dir ? join(dir, `ffprobe${exe}`) : "ffprobe";
  const res = spawnSync(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(String(res.stdout).trim());
}

describe("render yordamchilari", () => {
  it("findAerender va uniquePath", () => {
    expect(findAerender(null, null)).toBeNull();
    expect(findAerender(FAKE_AERENDER, null)).toBe(FAKE_AERENDER);
    expect(findAerender("C:/yoq/aerender.exe", null)).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "aes-uniq-"));
    expect(uniquePath(join(dir, "a"), ".mp4")).toBe(join(dir, "a.mp4"));
  });
});

describe.skipIf(!FFMPEG_AVAILABLE)("RENDER e2e", () => {
  it("aerender → ffmpeg → out/promo_v001.mp4, davomiylik spec'ga teng, hisobotda", async () => {
    const ae = createMockAE({ realDisk: true });
    const { mcp, project, root } = await setup(ae, FAKE_AERENDER);
    process.env.AES_FAKE_RENDER_S = "2.5";
    const { jobId, status } = await buildAndApprove(mcp, project.id);
    expect(status).toMatchObject({ state: "DONE", outcome: "success" });
    expect(status.renders[0]).toMatchObject({
      status: "done",
      local_path: "out/promo_v001.mp4",
      method: "aerender",
    });
    const file = join(root, "out", "promo_v001.mp4");
    expect(existsSync(file)).toBe(true);
    expect(Math.abs(probeDuration(file) - 2.5)).toBeLessThanOrEqual(1 / 30 + 0.01);
    // Oraliq papka o'chirilgan.
    expect(readdirSync(join(root, "out"))).toEqual(["promo_v001.mp4"]);

    // Qayta render: ustiga yozilmaydi → promo_v001_2.mp4
    await mcp.call("render_start", { job_id: jobId, preset: "h264_hq" });
    const again = await eventually(
      () => mcp.call("job_status", { job_id: jobId }),
      (res) => res.result.data.renders.every((r: { status: string }) => r.status !== "running"),
      60_000,
    );
    const paths = again.result.data.renders.map((r: { local_path: string }) => r.local_path).sort();
    expect(paths).toEqual(["out/promo_v001.mp4", "out/promo_v001_2.mp4"]);
  }, 180_000);

  it("davomiylik mos kelmasa → BLOCKED RENDER_DURATION_MISMATCH", async () => {
    const ae = createMockAE({ realDisk: true });
    const { mcp, project } = await setup(ae, FAKE_AERENDER);
    process.env.AES_FAKE_RENDER_S = "1";
    const { status } = await buildAndApprove(mcp, project.id);
    expect(status).toMatchObject({
      state: "BLOCKED",
      error: { code: "RENDER_DURATION_MISMATCH" },
    });
  }, 180_000);

  it("aerender yo'q → AE Render Queue zaxirasi", async () => {
    const dir = findFfmpegDir();
    const ffmpeg = dir ? join(dir, `ffmpeg${exe}`) : "ffmpeg";
    const ae = createMockAE({
      realDisk: true,
      onRender: (path) => {
        const res = spawnSync(ffmpeg, [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=320x240:rate=30:duration=2.5",
          "-c:v",
          "mpeg4",
          "-f",
          "mov",
          path,
        ]);
        if (res.status !== 0) throw new Error(String(res.stderr));
        return path;
      },
    });
    const { mcp, project, root } = await setup(ae, null);
    const { status } = await buildAndApprove(mcp, project.id);
    expect(status).toMatchObject({ state: "DONE" });
    expect(status.renders[0]).toMatchObject({ status: "done", method: "render_queue" });
    expect(existsSync(join(root, "out", "promo_v001.mp4"))).toBe(true);
    expect(ae.app.project.renderQueue.rendered).toHaveLength(1);
  }, 180_000);
});
