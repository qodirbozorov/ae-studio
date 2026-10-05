/**
 * P2.12 / P2.14: to'liq zanjir — kabinet (plan + job) → server holat mashinasi → WS → agent →
 * ffmpeg INGEST → haqiqiy ES3 bundle (mock AE) → Live ekrani holati → approve → hisobot.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import type { Agent } from "../src/agent/index";
import type { CompItem } from "./ae-mock";
import { createMockAE } from "./ae-mock";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

const SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { preset: "h264_social", name: "e2e" },
  scenes: [
    {
      id: "hook",
      dur: 2,
      transition_out: "fade",
      layers: [
        { type: "media", src: "asset:clip_01", anim: "ken_burns_in" },
        { type: "text", text: "Salom", anim: "pop" },
      ],
    },
    {
      id: "end",
      dur: 1.5,
      layers: [
        { type: "media", src: "asset:photo", fit: "contain", anim: "fade_in" },
        { type: "audio", src: "asset:vo", volume_db: -3 },
      ],
    },
  ],
};

describe.skipIf(!FFMPEG_AVAILABLE)("job e2e: plan → server → panel → AE", () => {
  it("2 sahnali video quriladi, Live ekrani holati yangilanadi, approve → hisobot", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-job-")).replace(/\\/g, "/");
    makeSourceFolder(root);
    const ae = createMockAE();
    const p = await pairedAgent(s.app, s.base, undefined, root, ae);
    agent = p.agent;
    p.agent.updateSettings({ ffmpeg_dir: findFfmpegDir() ?? null });
    const project = await p.agent.openProject(root);
    // Mock AE import qiladigan fayllar (haqiqiy fayllar ffmpeg bilan yaratilgan).
    const base = project.root_path;
    ae.files.set(`${base}/source/Clip 01.mp4`, {
      width: 1920,
      height: 1080,
      duration: 2,
      frameRate: 30,
      hasAudio: true,
    });
    ae.files.set(`${base}/source/Photo.png`, { width: 1000, height: 1500 });
    ae.files.set(`${base}/source/vo.wav`, { hasVideo: false, hasAudio: true, duration: 2 });

    const call = (method: "GET" | "POST", url: string, payload?: object) =>
      s.app.app
        .inject({ method, url, headers: { cookie: p.cookie }, ...(payload ? { payload } : {}) })
        .then((r) => r.json());

    expect(await call("POST", `/api/projects/${project.id}/plans`, { spec: SPEC })).toMatchObject({
      ok: true,
      data: { version: 1 },
    });
    const created = await call("POST", `/api/projects/${project.id}/jobs`, {});
    expect(created.ok).toBe(true);
    const jobId = created.data.id as string;

    const verify = await eventually(
      () => call("GET", `/api/jobs/${jobId}`),
      (res) => ["VERIFY", "BLOCKED"].includes(res.data.state),
      60_000,
    );
    expect(verify.data.error).toBeNull();
    expect(verify.data.state).toBe("VERIFY");

    // AE'da qurilgan.
    const items = ae.app.project.itemsList;
    const main = items.find((i) => i.name === "e2e") as CompItem;
    expect(main.layersList.map((l) => l.name)).toEqual(["end", "hook"]);
    expect(ae.app.project.file?.fsName).toBe(`${base}/${project.name}_v001.aep`);
    expect(ae.app.project.dirty).toBe(false);

    // Live ekrani (agent store) serverdan kelgan holatni ko'rsatadi.
    const live = await eventually(
      async () => p.agent.live.current(),
      (job) => job?.state === "VERIFY",
    );
    expect(live).toMatchObject({ id: jobId, state: "VERIFY" });
    expect(live!.progress.done).toBe(live!.progress.total);
    const types = p.agent.live.events().map((e) => e.type);
    expect(types).toContain("ingest.done");
    expect(types).toContain("build.done");

    expect((await call("POST", `/api/jobs/${jobId}/actions`, { action: "approve" })).ok).toBe(true);
    const done = await eventually(
      () => call("GET", `/api/jobs/${jobId}`),
      (res) => res.data.state === "DONE",
      10_000,
    );
    expect(done.data.outcome).toBe("success");
    const report = await call("GET", `/api/jobs/${jobId}/report`);
    expect(report.data.markdown).toContain(`${project.name}_v001.aep`);
    // Lokal nusxalar ish papkasida (§2.10).
    const plan = JSON.parse(readFileSync(join(root, ".aestudio", "plan.v001.json"), "utf8"));
    expect(plan.output.name).toBe("e2e");
    await eventually(
      async () => existsSync(join(root, ".aestudio", "report.v001.md")),
      (exists) => exists,
    );
    expect(readFileSync(join(root, ".aestudio", "report.v001.md"), "utf8")).toBe(
      report.data.markdown,
    );
    expect(
      await eventually(
        async () => p.agent.live.current()?.state,
        (state) => state === "DONE",
      ),
    ).toBe("DONE");
  }, 90_000);
});
