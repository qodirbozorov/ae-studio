/**
 * Faza 3 gate stsenariysi (P3.12): Claude qiladigan ishni faqat MCP toollari orqali bajaradi —
 * brief + rasmlar → plan → build → VERIFY kadrlari → ataylab qilingan xato patch qilinadi → approve →
 * render (out/*.mp4, davomiylik spec'ga mos) → hisobot. Lokal e2e va production smoke bir xil stsenariyni ishlatadi.
 */
import { expect } from "vitest";
import type { MockAE } from "./ae-mock";

export interface McpCall {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- javob shakli assert'larda tekshiriladi
  result: any;
  images: { data: string; mimeType: string }[];
  isError: boolean;
}

export interface McpCaller {
  call(name: string, args?: Record<string, unknown>): Promise<McpCall>;
}

export interface ScenarioResult {
  jobId: string;
  projectId: string;
  report: string;
  mp4: string;
  framesSeen: number;
  patchedVersion: number;
}

/** "Claude"ning birinchi rejasi: CTA sahnasida ataylab xato — juda qisqa va matnda imlo xatosi. */
export const FIRST_PLAN = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "gate" },
  scenes: [
    {
      id: "hook",
      dur: 2,
      transition_out: "fade",
      layers: [
        { type: "media", src: "asset:clip_01", anim: "ken_burns_in" },
        { type: "text", text: "3 ta sir", anim: "pop", style: { size: 120 } },
      ],
    },
    {
      id: "cta",
      dur: 0.5,
      layers: [
        { type: "media", src: "asset:photo", fit: "cover", anim: "fade_in" },
        { type: "text", text: "Obuna boling", anim: "slide_up" },
      ],
    },
  ],
};

async function poll(
  mcp: McpCaller,
  jobId: string,
  until: (state: string) => boolean,
  timeoutMs: number,
): Promise<McpCall> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await mcp.call("job_status", { job_id: jobId, log_limit: 5 });
    expect(res.result.ok, JSON.stringify(res.result)).toBe(true);
    if (until(res.result.data.state) || Date.now() > deadline) return res;
    await new Promise((r) => setTimeout(r, 300));
  }
}

export async function runReelScenario(options: {
  mcp: McpCaller;
  root: string;
  ae: MockAE;
  timeoutMs?: number;
}): Promise<ScenarioResult> {
  const { mcp, ae } = options;
  const timeout = options.timeoutMs ?? 120_000;

  // 1. Loyiha (foydalanuvchi bergan papka) va muhit tekshiruvi
  const project = await mcp.call("project_create", { root_path: options.root });
  expect(project.result.ok, JSON.stringify(project.result)).toBe(true);
  const projectId = project.result.data.id as string;
  const root = project.result.data.root_path as string;
  const env = await mcp.call("env_check");
  expect(env.result.data.ready, JSON.stringify(env.result.data.issues)).toBe(true);
  expect(env.result.data.checks.folder).toBe(root);

  // 2. Fayllar
  ae.files.set(`${root}/source/Clip 01.mp4`, {
    width: 1920,
    height: 1080,
    duration: 2,
    frameRate: 30,
    hasAudio: true,
  });
  ae.files.set(`${root}/source/Photo.png`, { width: 1000, height: 1500 });
  const scan = await mcp.call("assets_scan", { project_id: projectId });
  expect(scan.result.data.status).toBe("done");
  const list = await mcp.call("assets_list", { project_id: projectId, status: "ok" });
  const keys = list.result.data.assets.map((a: { key: string }) => a.key);
  expect(keys).toEqual(expect.arrayContaining(["clip_01", "photo"]));
  const preview = await mcp.call("asset_preview", {
    project_id: projectId,
    key: "photo",
    max_px: 256,
  });
  expect(preview.images).toHaveLength(1);

  // 3. Reja (ataylab xato bilan) → preflight → build
  await mcp.call("spec_schema");
  const plan = await mcp.call("plan_write", { project_id: projectId, spec: FIRST_PLAN });
  expect(plan.result.ok, JSON.stringify(plan.result)).toBe(true);
  const preflight = await mcp.call("preflight", { project_id: projectId });
  expect(preflight.result.data).toMatchObject({ ready: true, missing: [] });
  const started = await mcp.call("build_start", { project_id: projectId });
  expect(started.result.ok, JSON.stringify(started.result)).toBe(true);
  const jobId = started.result.data.id as string;

  // 4. VERIFY: kadrlarni ko'rish → xato topildi → patch (yangi .aep versiyasi)
  let status = await poll(mcp, jobId, (s) => ["VERIFY", "BLOCKED"].includes(s), timeout);
  expect(status.result.data.state, JSON.stringify(status.result.data.error)).toBe("VERIFY");
  const frames = await mcp.call("frames_capture", { job_id: jobId, max_px: 256 });
  expect(frames.images.length).toBeGreaterThan(1);
  const patched = await mcp.call("verify_patch", {
    job_id: jobId,
    patch: [
      { op: "replace", path: "/scenes/1/dur", value: 2 },
      { op: "replace", path: "/scenes/1/layers/1/text", value: "Obuna bo'ling!" },
    ],
    reason: "CTA juda qisqa (0.5 s) va matnda imlo xatosi",
  });
  expect(patched.result.data).toMatchObject({ patch_count: 1, patches_left: 2 });
  status = await poll(mcp, jobId, (s) => ["VERIFY", "BLOCKED"].includes(s), timeout);
  expect(status.result.data).toMatchObject({
    state: "VERIFY",
    aep_path: expect.stringMatching(/_v002\.aep$/),
  });
  const again = await mcp.call("frames_capture", { job_id: jobId, max_px: 256 });
  expect(again.images.length).toBeGreaterThan(1);

  // 5. Approve → RENDER → REPORT
  const final = await mcp.call("preflight", { project_id: projectId });
  process.env.AES_FAKE_RENDER_S = String(final.result.data.duration_s);
  await mcp.call("verify_approve", { job_id: jobId });
  status = await poll(mcp, jobId, (s) => ["DONE", "BLOCKED"].includes(s), timeout);
  expect(status.result.data, JSON.stringify(status.result.data.error)).toMatchObject({
    state: "DONE",
    outcome: "success",
  });
  const report = await mcp.call("report_get", { job_id: jobId });
  const video = report.result.data.renders[0];
  expect(video).toMatchObject({ status: "done", local_path: "out/gate_v002.mp4" });
  expect(Math.abs(video.duration_s - final.result.data.duration_s)).toBeLessThanOrEqual(
    1 / 30 + 0.01,
  );
  expect(report.result.data.markdown).toContain("out/gate_v002.mp4");
  expect(report.result.data.markdown).toContain("Patch'lar: 1");
  return {
    jobId,
    projectId,
    report: report.result.data.markdown,
    mp4: video.local_path,
    framesSeen: frames.images.length + again.images.length,
    patchedVersion: patched.result.data.plan_version,
  };
}
