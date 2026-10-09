/**
 * P6.02: kadrlar va contact sheet — haqiqiy agent + ffmpeg + ES3 bundle, mock AE haqiqiy AE kabi kadrni
 * asinxron yozadi (`saveFrameToPng` skript tugagandan keyin). Eski xulq (ExtendScript ichida kutish) bu
 * rejimda AE_TIMEOUT berardi (update-technicalguidline #3).
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { sheetFilter, waitForFrames } from "../src/agent/frames";
import { createMockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

describe("kadrlar (birlik)", () => {
  it("jsx frames.capture kutmaydi: pending qaytaradi, fayl keyinroq yoziladi", async () => {
    const ROOT = "D:/Projects/reel";
    const h = await loadJsx(createMockAE({ asyncFrames: true }));
    h.run("comp.create", "main", { name: "M", w: 100, h: 100, fps: 30, dur: 2 });
    const res = h.run("frames.capture", "f1", { comp: "main", times: [0.5], dir: "frames/x" });
    expect(res).toMatchObject({ ok: true, data: { info: { pending: true } } });
    expect(h.ae.files.has(`${ROOT}/frames/x/frame_01.png`)).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(h.ae.files.has(`${ROOT}/frames/x/frame_01.png`)).toBe(true);
  });

  it("waitForFrames: fayllar paydo bo'lsa null; bo'lmasa FRAME_CAPTURE_FAILED{timeout, missing}", async () => {
    const root = mkdtempSync(join(tmpdir(), "aes-wait-"));
    let clock = 0;
    const fake = { sleep: async (ms: number) => void (clock += ms), now: () => clock };
    const missing = await waitForFrames(root, ["frames/a.png"], { perFrameMs: 500, ...fake });
    expect(missing).toMatchObject({
      code: "FRAME_CAPTURE_FAILED",
      details: { reason: "timeout", missing: ["frames/a.png"] },
    });
    expect(await waitForFrames(root, ["../x.png"])).toMatchObject({ code: "ASSET_OUTSIDE_ROOT" });
  });

  it("sheetFilter: xstack joylashuvi, yozuvlar, bitta kadr", () => {
    const f = sheetFilter({
      count: 4,
      cols: 3,
      cellW: 300,
      cellH: 534,
      labels: ["0.60 s", "1.00 s", "2.00 s", "3.10 s"],
      font: "C:/Windows/Fonts/arial.ttf",
    });
    expect(f).toContain("xstack=inputs=4:layout=0_0|300_0|600_0|0_558");
    expect(f).toContain("text='0.60 s'");
    expect(f).toContain("fontfile='C\\:/Windows/Fonts/arial.ttf'");
    const one = sheetFilter({
      count: 1,
      cols: 3,
      cellW: 300,
      cellH: 300,
      labels: ["1.00 s"],
      font: null,
    });
    expect(one).not.toContain("xstack");
    expect(one).not.toContain("drawtext");
    expect(one.endsWith("[out]")).toBe(true);
  });
});

describe.skipIf(!FFMPEG_AVAILABLE)("contact_sheet (haqiqiy agent + ffmpeg)", () => {
  it("asinxron kadrlar bilan 10/10 muvaffaqiyatli; grid JPEG ish papkasida", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-sheet-")).replace(/\\/g, "/");
    makeSourceFolder(root);
    const ae = createMockAE({ realDisk: true, asyncFrames: true });
    const p = await pairedAgent(s.app, s.base, undefined, "", ae);
    agent = p.agent;
    p.agent.updateSettings({ ffmpeg_dir: findFfmpegDir() ?? null });
    const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);
    const project = (await mcp.call("project_create", { root_path: root })).result.data;
    ae.files.set(`${project.root_path}/source/Photo.png`, { width: 1000, height: 1500 });
    await mcp.call("assets_scan", { project_id: project.id });
    await mcp.call("plan_write", {
      project_id: project.id,
      spec: {
        version: 1,
        format: { w: 1080, h: 1920, fps: 30 },
        output: { name: "sheet" },
        scenes: [
          { id: "a", dur: 2, bg: "#F5F3ED", layers: [{ type: "text", text: "Salom" }] },
          { id: "b", dur: 2, layers: [{ type: "media", src: "asset:photo" }] },
        ],
      },
    });
    const jobId = (await mcp.call("build_start", { project_id: project.id })).result.data.id;
    await eventually(
      () => mcp.call("job_status", { job_id: jobId }),
      (r) => ["VERIFY", "BLOCKED"].includes(r.result.data.state),
      60_000,
    );
    for (let i = 0; i < 10; i++) {
      const res = await mcp.call("contact_sheet", { job_id: jobId, max_px: 180 });
      expect(res.result.ok, `${i}: ${JSON.stringify(res.result.error)}`).toBe(true);
      expect(res.images).toHaveLength(1);
      const jpeg = Buffer.from(res.images[0]!.data, "base64");
      expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
      const local = join(root, res.result.data.sheet_path);
      expect(existsSync(local)).toBe(true);
      expect(readFileSync(local).length).toBe(jpeg.length);
    }
  }, 300_000);
});
