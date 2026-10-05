/**
 * P4.04: kirish audiosi — haqiqiy agent + ffmpeg: video → mono Opus → storage (`audio-in`), sha256 va davomiylik.
 */
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractInput } from "../../server/src/audio/inputs";
import type { TestApp } from "../../server/test/helpers/app";
import type { Agent } from "../src/agent/index";
import { pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

describe.skipIf(!FFMPEG_AVAILABLE)("audio.extract.request", () => {
  it("video ovozi → Opus storage'da; ovozsiz fayl va papkadan tashqari yo'l rad etiladi", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-ext-"));
    makeSourceFolder(root);
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    p.agent.updateSettings({ ffmpeg_dir: findFfmpegDir() ?? null });
    const info = await p.agent.openProject(root);
    const project = {
      id: info.id,
      userId: (await s.app.app.inject({ url: "/api/me", headers: { cookie: p.cookie } })).json()
        .data.id,
      deviceId: p.credentials.device_id,
      name: info.name,
      rootPath: info.root_path,
      createdAt: new Date(),
    };
    const ctx = { hub: s.app.app.hub, storage: s.app.app.storage };

    const res = await extractInput(ctx, project, "source/Clip 01.mp4");
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data.storage_key).toMatch(/\/audio-in\/in[0-9a-f]{32}\.ogg$/);
    expect(Math.abs(res.data.duration_s! - 2)).toBeLessThan(0.1);
    const bytes = await s.app.app.storage.getBytes(res.data.storage_key);
    expect(bytes!.subarray(0, 4).toString("latin1")).toBe("OggS");
    expect(createHash("sha256").update(bytes!).digest("hex")).toBe(res.data.sha256);

    const silent = await extractInput(ctx, project, "source/b-roll/clip_01.mov");
    expect(silent).toMatchObject({ ok: false, error: { code: "ASSET_UNSUPPORTED" } });
    const outside = await extractInput(ctx, project, "../secret.mp4");
    expect(outside).toMatchObject({ ok: false, error: { code: "ASSET_OUTSIDE_ROOT" } });
    const wav = await extractInput(ctx, project, "source/vo.wav", { format: "wav" });
    expect(wav.ok && wav.data.storage_key.endsWith(".wav")).toBe(true);
  }, 120_000);
});
