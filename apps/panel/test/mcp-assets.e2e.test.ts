/**
 * P3.04: MCP fayl toollari — haqiqiy agent + ffmpeg: assets_scan → assets_list → asset_preview (image content).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { previewTimes } from "../src/agent/preview";
import { pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

describe("previewTimes", () => {
  it("image: 10% kadr; frames: teng oraliq yoki berilgan vaqtlar (davomiylikka siqiladi)", () => {
    expect(previewTimes("image", null, undefined, undefined, 1)).toEqual([null]);
    expect(previewTimes("image", 10, undefined, undefined, 1)).toEqual([1]);
    expect(previewTimes("frames", 8, undefined, 4, 4)).toEqual([1, 3, 5, 7]);
    expect(previewTimes("frames", 2, [0.5, 5], undefined, 8)).toEqual([0.5, 1.95]);
    expect(previewTimes("frames", 8, undefined, 4, 2)).toEqual([1, 3]);
  });
});

describe.skipIf(!FFMPEG_AVAILABLE)("MCP fayl toollari e2e", () => {
  it("skan, ro'yxat, rasm va video kadrlari Claude'ga JPEG sifatida", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-mcpa-"));
    makeSourceFolder(root);
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    p.agent.updateSettings({ ffmpeg_dir: findFfmpegDir() ?? null });
    const project = await p.agent.openProject(root);
    const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);

    const scan = await mcp.call("assets_scan", { project_id: project.id });
    expect(scan.result).toMatchObject({
      ok: true,
      data: { status: "done", count: 6, by_status: { ok: 4, corrupt: 1, unsupported: 1 } },
    });

    const list = await mcp.call("assets_list", { project_id: project.id, status: "ok" });
    const byKey = Object.fromEntries(
      list.result.data.assets.map((a: { key: string }) => [a.key, a]),
    );
    expect(byKey.clip_01).toMatchObject({
      ref: "asset:clip_01",
      kind: "video",
      width: 1920,
      height: 1080,
      duration: 2,
    });
    expect(Object.keys(byKey).sort()).toEqual(["clip_01", "clip_01_2", "photo", "vo"]);

    const photo = await mcp.call("asset_preview", {
      project_id: project.id,
      key: "photo",
      max_px: 256,
    });
    expect(photo.result).toMatchObject({
      ok: true,
      data: { mode: "image", frames: [{ time: null }] },
    });
    expect(photo.images).toHaveLength(1);
    expect(photo.images[0]!.mimeType).toBe("image/jpeg");
    const jpeg = Buffer.from(photo.images[0]!.data, "base64");
    expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");

    const frames = await mcp.call("asset_preview", {
      project_id: project.id,
      key: "clip_01",
      mode: "frames",
      count: 3,
      max_px: 320,
    });
    expect(frames.result.data.frames.map((f: { time: number }) => f.time)).toEqual([
      0.333, 1, 1.667,
    ]);
    expect(frames.images).toHaveLength(3);

    const audio = await mcp.call("asset_preview", { project_id: project.id, key: "vo" });
    expect(audio.result.error.code).toBe("ASSET_UNSUPPORTED");
    const unknown = await mcp.call("asset_preview", { project_id: project.id, key: "yoq" });
    expect(unknown.result.error.code).toBe("SPEC_UNKNOWN_ASSET");
    const broken = await mcp.call("asset_preview", { project_id: project.id, key: "broken" });
    expect(broken.result.error.code).toBe("ASSET_CORRUPT");

    p.agent.disconnect();
    const offline = await mcp.call("assets_scan", { project_id: project.id });
    expect(offline.result.error.code).toBe("ENV_AGENT_OFFLINE");
  }, 120_000);
});
