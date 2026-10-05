/**
 * Production smoke (P2.14 gate dalili): deploy qilingan serverga qarshi haqiqiy agent (mock AE).
 * Faqat qo'lda ishga tushiriladi:
 *   AES_PROD_URL=https://… AES_PROD_COOKIE='aes_session=…' pnpm vitest run apps/panel/test/prod.smoke.test.ts
 * Device flow → ish papkasi → plan → job → INGEST (ffmpeg) → BUILD o'rtasida uzilish → WAITING_AGENT →
 * qayta ulanish → dublikatsiz VERIFY → approve → DONE va hisobot.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent/index";
import type { Agent } from "../src/agent/index";
import { CompItem, createMockAE } from "./ae-mock";
import { eventually, waitFor } from "./e2e-helpers";
import { loadJsx } from "./jsx-harness";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

const BASE = process.env.AES_PROD_URL;
const COOKIE = process.env.AES_PROD_COOKIE;

const SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "smoke" },
  scenes: [
    {
      id: "hook",
      dur: 2,
      transition_out: "whip_left",
      layers: [
        { type: "media", src: "asset:clip_01", anim: "ken_burns_in" },
        { type: "text", text: "3 ta xato", anim: "pop", style: { size: 120 } },
      ],
    },
    {
      id: "point",
      dur: 2,
      bg: "#101820",
      transition_out: "fade",
      layers: [
        { type: "media", src: "asset:photo", fit: "contain", anim: "fade_in" },
        {
          type: "shape",
          kind: "rect",
          color: "#FFCC00",
          size: { w: 0.8, h: 0.08 },
          pos: "lower_third",
        },
        { type: "text", text: "Ko'p odam buni bilmaydi", pos: "lower_third", anim: "typewriter" },
      ],
    },
    {
      id: "cta",
      dur: 1.5,
      layers: [
        { type: "text", text: "Obuna bo'ling!", anim: "slide_up", style: { all_caps: true } },
        { type: "audio", src: "asset:vo", volume_db: -6 },
      ],
    },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- smoke: javob shakli testda tekshiriladi
type Json = { ok: boolean; data?: any; error?: any };

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      cookie: COOKIE!,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await response.json()) as Json;
}

describe.skipIf(!BASE || !COOKIE || !FFMPEG_AVAILABLE)("production smoke", () => {
  it("panel ulanadi, 3 sahnali video quriladi, uzilishdan dublikatsiz davom etadi", async () => {
    const root = mkdtempSync(join(tmpdir(), "aes-smoke-")).replace(/\\/g, "/");
    makeSourceFolder(root);
    const ae = createMockAE({ realDisk: true });
    const h = await loadJsx(ae);
    const agent: Agent = createAgent({
      evalScript: h.evalScript,
      root,
      dataDir: mkdtempSync(join(tmpdir(), "aes-smoke-data-")),
      panelVersion: "smoke",
    });
    try {
      // M2: web kabinetdagi kod orqali ulanish (device flow).
      const pairing = agent.pair(BASE!);
      const code = await pairing.code;
      const confirmed = await call("POST", "/api/devices/confirm", {
        user_code: code.user_code,
        approve: true,
      });
      expect(confirmed.ok).toBe(true);
      await pairing.done;
      await waitFor(agent, "connected", 20_000);

      const ffmpegDir = findFfmpegDir() ?? null;
      agent.updateSettings({
        ffmpeg_dir: ffmpegDir,
        aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
      });
      process.env.AES_FAKE_RENDER_S = "5.5";
      process.env.AES_FAKE_FFMPEG =
        ffmpegDir === null
          ? "ffmpeg"
          : join(ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      const project = await agent.openProject(root);
      const base = project.root_path;
      ae.files.set(`${base}/source/Clip 01.mp4`, {
        width: 1920,
        height: 1080,
        duration: 2,
        frameRate: 30,
        hasAudio: true,
      });
      ae.files.set(`${base}/source/Photo.png`, { width: 1000, height: 1500 });
      ae.files.set(`${base}/source/vo.wav`, { hasVideo: false, hasAudio: true, duration: 1 });

      expect((await call("POST", `/api/projects/${project.id}/plans`, { spec: SPEC })).ok).toBe(
        true,
      );
      const created = await call("POST", `/api/projects/${project.id}/jobs`, {});
      expect(created.ok).toBe(true);
      const jobId = created.data.id as string;

      // M2/M3: BUILD o'rtasida panel uziladi (AE yopilgandek) → WAITING_AGENT.
      await eventually(
        async () => agent.live.current(),
        (job) => job?.state === "BUILD" && job.scene_id === "point",
        60_000,
      );
      agent.disconnect();
      const waiting = await eventually(
        () => call("GET", `/api/jobs/${jobId}`),
        (res) => res.data.state === "WAITING_AGENT",
        30_000,
      );
      expect(waiting.data).toMatchObject({ state: "WAITING_AGENT", prev_state: "BUILD" });

      // Qayta ulanish → davom.
      agent.connectSaved();
      await waitFor(agent, "connected", 20_000);
      const verify = await eventually(
        () => call("GET", `/api/jobs/${jobId}`),
        (res) => ["VERIFY", "BLOCKED"].includes(res.data.state),
        120_000,
      );
      expect(verify.data.error).toBeNull();
      expect(verify.data.state).toBe("VERIFY");

      // Dublikat yo'q: har sahna comp'i bitta, asosiy comp'da 3 ta nest.
      const comps = ae.app.project.itemsList.filter((i) => i instanceof CompItem) as CompItem[];
      const names = comps.map((c) => c.name).sort();
      expect(names).toEqual(["01_hook", "02_point", "03_cta", "smoke"]);
      const main = comps.find((c) => c.name === "smoke")!;
      expect(main.layersList.map((l) => l.name)).toEqual(["cta", "point", "hook"]);
      expect(comps.find((c) => c.name === "02_point")!.numLayers).toBe(3);

      expect((await call("POST", `/api/jobs/${jobId}/actions`, { action: "approve" })).ok).toBe(
        true,
      );
      const done = await eventually(
        () => call("GET", `/api/jobs/${jobId}`),
        (res) => res.data.state === "DONE",
        30_000,
      );
      expect(done.data.outcome).toBe("success");
      const report = await call("GET", `/api/jobs/${jobId}/report`);
      expect(report.data.markdown).toContain("_v001.aep");
      expect(report.data.markdown).toContain("Video: `out/smoke_v001.mp4`");
      expect(existsSync(join(root, "out", "smoke_v001.mp4"))).toBe(true);
      await eventually(
        async () => existsSync(join(root, ".aestudio", "report.v001.md")),
        (exists) => exists,
        15_000,
      );
      expect(readFileSync(join(root, ".aestudio", "report.v001.md"), "utf8")).toBe(
        report.data.markdown,
      );
      const events = await call("GET", `/api/jobs/${jobId}/events`);
      const types = (events.data as { type: string }[]).map((e) => e.type);
      expect(types).toContain("agent.waiting");
      expect(types).toContain("build.resume");
      console.log(`smoke OK: job ${jobId}, loyiha ${project.id}`);
      console.log(report.data.markdown);
    } finally {
      agent.logout();
    }
  }, 300_000);
});
