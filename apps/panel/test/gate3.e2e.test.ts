/**
 * P3.12 — Faza 3 gate (kod qismi): faqat MCP orqali, haqiqiy server + agent + ffmpeg + ES3 bundle (mock AE):
 * brief + rasmlar → video quriladi → Claude kadrlarni ko'rib ataylab qilingan xatoni patch qiladi →
 * out/*.mp4 (davomiylik spec'ga mos) → hisobot chatda.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { createMockAE } from "./ae-mock";
import { pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";
import { runReelScenario } from "./reel-scenario";

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

describe.skipIf(!FFMPEG_AVAILABLE)("Faza 3 gate: Claude loop'i MCP orqali", () => {
  it("brief → build → VERIFY patch → render → hisobot", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-gate3-")).replace(/\\/g, "/");
    makeSourceFolder(root);
    const ae = createMockAE({ realDisk: true });
    // Panel hali boshqa papkada: loyihani Claude project_create bilan ochadi.
    const p = await pairedAgent(s.app, s.base, undefined, "", ae);
    agent = p.agent;
    const ffmpegDir = findFfmpegDir() ?? null;
    p.agent.updateSettings({
      ffmpeg_dir: ffmpegDir,
      aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
    });
    process.env.AES_FAKE_FFMPEG = ffmpegDir === null ? "ffmpeg" : join(ffmpegDir, `ffmpeg${exe}`);
    const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);

    const result = await runReelScenario({ mcp, root, ae });
    expect(result.patchedVersion).toBe(2);
    expect(result.framesSeen).toBeGreaterThan(3);

    // /out da mp4, davomiylik spec'ga mos (CTA 2 s bilan jami 4 s).
    const file = join(root, result.mp4);
    expect(existsSync(file)).toBe(true);
    const ffprobe = ffmpegDir === null ? "ffprobe" : join(ffmpegDir, `ffprobe${exe}`);
    const probed = spawnSync(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]);
    expect(Math.abs(Number(String(probed.stdout).trim()) - 4)).toBeLessThanOrEqual(1 / 30 + 0.01);
    // Hech narsa ustiga yozilmagan: ikkala .aep versiyasi va lokal plan/hisobot nusxalari bor.
    for (const name of ["gate_v001.aep", "gate_v002.aep"]) {
      const project = p.agent.currentProject()!;
      expect(existsSync(join(root, name.replace("gate", project.name))), name).toBe(true);
    }
    expect(existsSync(join(root, ".aestudio", "plan.v002.json"))).toBe(true);
    expect(existsSync(join(root, ".aestudio", "report.v002.md"))).toBe(true);
  }, 300_000);
});
