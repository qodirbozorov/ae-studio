/**
 * P5.06: panel Shablonlar ekrani (Claude'siz rejim) — galereya, sxema, slot tekshiruvi va haqiqiy agent orqali
 * shablondan video: REST → plan + job (auto_approve) → BUILD (ES3 bundle, mock AE) → VERIFY avtomatik → render.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import type { Agent } from "../src/agent/index";
import { sketchItems, slotPayload, validateSlots } from "../src/agent/templates";
import { createMockAE } from "./ae-mock";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

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

async function setup() {
  const s = await start();
  t = s.app;
  const root = mkdtempSync(join(tmpdir(), "aes-tpl-")).replace(/\\/g, "/");
  makeSourceFolder(root);
  const ae = createMockAE({ realDisk: true });
  const p = await pairedAgent(s.app, s.base, undefined, "", ae);
  agent = p.agent;
  const ffmpegDir = findFfmpegDir() ?? null;
  p.agent.updateSettings({
    ffmpeg_dir: ffmpegDir,
    aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
  });
  process.env.AES_FAKE_FFMPEG = ffmpegDir === null ? "ffmpeg" : join(ffmpegDir, `ffmpeg${exe}`);
  const project = await p.agent.openProject(root);
  ae.files.set(`${project.root_path}/source/Clip 01.mp4`, {
    width: 1920,
    height: 1080,
    duration: 2,
    frameRate: 30,
    hasAudio: true,
  });
  ae.files.set(`${project.root_path}/source/Photo.png`, { width: 1000, height: 1500 });
  await p.agent.scanAssets();
  return { agent: p.agent, project, root, ae };
}

describe("Shablonlar ekrani (Claude'siz)", () => {
  it("galereya: kutubxona shablonlari, sxema, slot tekshiruvi", async () => {
    const { agent: a, project } = await setup();
    const list = await a.templates();
    expect(list.map((x) => x.slug)).toEqual(
      expect.arrayContaining(["hook_title", "lower_third", "cta_outro", "top3_list"]),
    );
    const hook = list.find((x) => x.slug === "hook_title")!;
    const items = sketchItems(hook);
    expect(items.map((i) => i.kind)).toEqual(["media", "rect", "text", "text", "rect"]);
    // Sarlavha matni slot nomi bilan; rang tokeni default rang bo'ladi.
    expect(items.find((i) => i.kind === "text" && i.text === "Sarlavha")).toBeDefined();
    expect(items.at(-1)!.color).toBe("#FFCC00");

    expect(validateSlots(hook, {})).toMatch(/Sarlavha/);
    expect(validateSlots(hook, { title: "x".repeat(41), bg: "asset:clip_01" })).toMatch(/41\/40/);
    expect(validateSlots(hook, { title: "Salom", bg: "asset:clip_01", accent: "red" })).toMatch(
      /#RRGGBB/,
    );
    expect(validateSlots(hook, { title: "Salom", bg: "asset:clip_01" })).toBeNull();
    expect(slotPayload(hook, { title: " Salom ", bg: "asset:clip_01", kicker: "" })).toEqual({
      title: "Salom",
      bg: "asset:clip_01",
    });

    const assets = await a.projectAssets(project.id);
    expect(assets.map((x) => x.key)).toEqual(expect.arrayContaining(["clip_01", "photo"]));
  });

  it.skipIf(!FFMPEG_AVAILABLE)(
    "slotlar → job (VERIFY avtomatik) → asosiy + 16:9 renderlar",
    async () => {
      const { agent: a, project, root } = await setup();
      process.env.AES_FAKE_RENDER_S = "3";
      const bad = await a.runTemplate("hook_title", { project_id: project.id, slots: {} });
      expect(bad).toMatchObject({ ok: false, message: expect.stringContaining("slots/title") });

      const res = await a.runTemplate("hook_title", {
        project_id: project.id,
        slots: { title: "Shablondan video", bg: "asset:clip_01" },
        format: "9:16",
        variants: ["16:9"],
        dur: 3,
      });
      expect(res.ok, res.message).toBe(true);
      const job = await eventually(
        async () => (await a.history()).find((j) => j.id === res.job_id),
        (j) => j !== undefined && j.state === "DONE",
        120_000,
      );
      expect(job).toMatchObject({ state: "DONE", outcome: "success" });
      expect(existsSync(join(root, "out", "hook_title_v001.mp4"))).toBe(true);
      expect(existsSync(join(root, "out", "hook_title_16x9_v001.mp4"))).toBe(true);
    },
    300_000,
  );
});
