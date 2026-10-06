/**
 * P5.14 — Faza 5 gate (kod qismi): haqiqiy server + haqiqiy agent + ffmpeg + ES3 bundle (mock AE) + soxta aerender,
 * Claude oqimi MCP orqali:
 * 1) bitta Spec'dan 9:16, 1:1 va 16:9 variantlar brand kit bilan (shablon tokenlari, shrift, rang, logo) → 3 ta MP4;
 * 2) shablon + CSV (3 qator) → 3 ta video + Telegram'ga bitta umumiy xabar.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { FakeTelegram } from "../../server/test/helpers/fake-telegram";
import { mcpSessionForDevice } from "../../server/test/helpers/mcp";
import type { McpSession } from "../../server/test/helpers/mcp";
import type { Agent } from "../src/agent/index";
import { createMockAE } from "./ae-mock";
import type { CompItem, MockAE } from "./ae-mock";
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

const BRAND = {
  slug: "acme",
  name: "Acme",
  colors: { primary: "#1E40AF", accent: "#F59E0B", text: "#FAFAFA", background: "#0B1020" },
  fonts: {
    heading: { family: "Montserrat-Bold", fallback: ["Arial-BoldMT"] },
    body: { family: "Inter-Regular", fallback: ["ArialMT"] },
  },
  logo: "asset:photo",
  captions: { style: "bold_pop" },
};

async function setup(tg?: FakeTelegram) {
  const s = await start(
    undefined,
    undefined,
    tg === undefined ? {} : { telegramOptions: { fetch: tg.fetch, poll: false } },
    tg === undefined
      ? {}
      : {
          TELEGRAM_BOT_TOKEN: "TEST:TOKEN",
          TELEGRAM_BOT_USERNAME: "aestudio_bot",
          TELEGRAM_API_URL: "https://tg.test",
        },
  );
  t = s.app;
  const root = mkdtempSync(join(tmpdir(), "aes-gate5-")).replace(/\\/g, "/");
  makeSourceFolder(root);
  // AE 24+ shriftlari: brand heading bor, body yo'q → fallback ArialMT.
  const ae = createMockAE({ realDisk: true, fonts: ["Montserrat-Bold", "ArialMT"] });
  const p = await pairedAgent(s.app, s.base, undefined, "", ae);
  agent = p.agent;
  const ffmpegDir = findFfmpegDir() ?? null;
  p.agent.updateSettings({
    ffmpeg_dir: ffmpegDir,
    aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
  });
  process.env.AES_FAKE_FFMPEG = ffmpegDir === null ? "ffmpeg" : join(ffmpegDir, `ffmpeg${exe}`);
  const mcp = await mcpSessionForDevice(s.app, p.credentials.device_id);
  const project = (await mcp.call("project_create", { root_path: root })).result.data;
  ae.files.set(`${project.root_path}/source/Clip 01.mp4`, {
    width: 1920,
    height: 1080,
    duration: 2,
    frameRate: 30,
    hasAudio: true,
  });
  ae.files.set(`${project.root_path}/source/Photo.png`, { width: 1000, height: 1500 });
  expect((await mcp.call("assets_scan", { project_id: project.id })).result.data.status).toBe(
    "done",
  );
  return { s, mcp, project, root, ae, cookie: p.cookie };
}

async function untilState(mcp: McpSession, jobId: string, states: string[]) {
  const res = await eventually(
    () => mcp.call("job_status", { job_id: jobId, log_limit: 30 }),
    (r) => states.includes(r.result.data.state),
    120_000,
  );
  return res.result.data;
}

const comp = (ae: MockAE, name: string) =>
  ae.app.project.itemsList.find((i) => i.name === name) as CompItem;

describe.skipIf(!FFMPEG_AVAILABLE)("Faza 5 gate", () => {
  it("bitta Spec → 9:16, 1:1, 16:9 brand kit bilan (M7)", async () => {
    const { mcp, project, root, ae } = await setup();
    expect((await mcp.call("brand_save", { brand: BRAND })).result.ok).toBe(true);
    const spec = {
      version: 1,
      brand: "acme",
      format: { w: 1080, h: 1920, fps: 30 },
      variants: ["1:1", "16:9"],
      output: { name: "launch" },
      scenes: [
        {
          id: "hook",
          dur: 1.5,
          template: "hook_title",
          slots: { title: "Yangi mahsulot", kicker: "Yangi", bg: "asset:clip_01" },
          transition_out: "fade",
        },
        { id: "cta", dur: 1.5, template: "cta_outro", slots: { headline: "Hoziroq sinang" } },
      ],
    };
    expect((await mcp.call("plan_write", { project_id: project.id, spec })).result.ok).toBe(true);
    const pre = await mcp.call("preflight", { project_id: project.id });
    expect(pre.result.data).toMatchObject({ ready: true, duration_s: 3 });
    const jobId = (await mcp.call("build_start", { project_id: project.id })).result.data.id;
    const verify = await untilState(mcp, jobId, ["VERIFY", "BLOCKED"]);
    expect(verify.state, JSON.stringify(verify.error)).toBe("VERIFY");

    // AE: uch asosiy comp to'g'ri o'lchamda.
    expect([comp(ae, "launch").width, comp(ae, "launch").height]).toEqual([1080, 1920]);
    expect([comp(ae, "launch_1x1").width, comp(ae, "launch_1x1").height]).toEqual([1080, 1080]);
    expect([comp(ae, "launch_16x9").width, comp(ae, "launch_16x9").height]).toEqual([1920, 1080]);
    // Brand: sahna foni, sarlavha shrifti va rangi, body fallback, logo.
    expect(comp(ae, "16x9_02_cta").bgColor.map((v) => Math.round(v * 255))).toEqual([11, 16, 32]);
    const textDoc = (sceneName: string, layerName: string) =>
      comp(ae, sceneName)
        .layersList.find((l) => l.name === layerName)!
        .property("ADBE Text Properties")
        .property("ADBE Text Document").value as { font: string; fillColor: number[] };
    expect(textDoc("01_hook", "title").font).toBe("Montserrat-Bold");
    expect(textDoc("1x1_01_hook", "title").fillColor.map((v) => Math.round(v * 255))).toEqual([
      250, 250, 250,
    ]);
    expect(comp(ae, "02_cta").layersList.some((l) => l.name === "logo")).toBe(true);
    // Body shrifti (Inter-Regular) AE'da yo'q → fallback ArialMT.
    expect(textDoc("01_hook", "kicker").font).toBe("ArialMT");

    const frames = await mcp.call("frames_capture", {
      job_id: jobId,
      variant: "16:9",
      max_px: 256,
    });
    expect(frames.images.length).toBeGreaterThan(0);

    process.env.AES_FAKE_RENDER_S = "3";
    await mcp.call("verify_approve", { job_id: jobId });
    const done = await untilState(mcp, jobId, ["DONE", "BLOCKED"]);
    expect(done).toMatchObject({ state: "DONE", outcome: "success" });
    for (const file of ["launch_v001.mp4", "launch_1x1_v001.mp4", "launch_16x9_v001.mp4"]) {
      expect(existsSync(join(root, "out", file)), file).toBe(true);
    }
    const report = (await mcp.call("report_get", { job_id: jobId })).result.data.markdown as string;
    expect(report).toContain("launch_16x9_v001.mp4");
  }, 300_000);

  it("shablon + CSV (3 qator) → 3 ta video + Telegram xabar", async () => {
    const tg = new FakeTelegram();
    const { s, mcp, project, root, cookie } = await setup(tg);
    // Telegram'ni bog'lash (kabinet → kod → botga /start).
    const code = await s.app.app.inject({
      method: "POST",
      url: "/api/settings/telegram/code",
      headers: { cookie },
    });
    tg.userWrites(4242, `/start ${code.json().data.code}`);
    await s.app.app.telegram.pollOnce(0);
    expect(tg.sent.at(-1)!.text).toContain("ulandi");

    process.env.AES_FAKE_RENDER_S = "3";
    const csv = [
      "name,title,item1,item2,item3",
      "ovqat,3 ta retsept,Palov,Manti,Lag'mon",
      'sport,"Ertalab, 3 mashq",Yugurish,Turnik,Plank',
      "kitob,3 ta kitob,Alkimyogar,O'tkan kunlar,Sariq devni minib",
    ].join("\n");
    const started = await mcp.call("batch_start", {
      project_id: project.id,
      template: "top3_list",
      csv,
      format: "1:1",
      dur: 3,
    });
    expect(started.result.data).toMatchObject({ total: 3, status: "running" });
    const finished = await eventually(
      () => mcp.call("batch_status", { batch_id: started.result.data.id }),
      (r) => r.result.data.status !== "running",
      240_000,
    );
    expect(finished.result.data).toMatchObject({ status: "done", done: 3, failed: 0 });
    for (const file of ["ovqat_v001.mp4", "sport_v002.mp4", "kitob_v003.mp4"]) {
      expect(existsSync(join(root, "out", file)), file).toBe(true);
    }
    await s.app.app.telegram.idle();
    const summary = tg.sent.filter((m) => m.text.startsWith("📦"));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ chat_id: "4242" });
    expect(summary[0]!.text).toContain("3/3");
    expect(summary[0]!.text).toContain("out/sport_v002.mp4");
  }, 400_000);
});
