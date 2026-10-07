import { makeOp } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { buildRunOpScript, scriptLiteral } from "../src/agent/ae-bridge";
import { createAgent } from "../src/agent/index";
import type { RunnerEvent } from "../src/agent/op-runner";
import { createMockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

describe("agent → ExtendScript (mock AE, haqiqiy jsx bundle)", () => {
  it("ping: natija, live log (⏳ → ✅) va eventlar", async () => {
    const h = await loadJsx();
    const agent = createAgent({ evalScript: h.evalScript, root: "D:/reel" });
    const events: RunnerEvent["type"][] = [];
    agent.runner.onEvent((event) => events.push(event.type));

    const outcome = await agent.runner.submit(makeOp("ping", "p1", 0, {}), "job-1");
    expect(outcome.response).toMatchObject({ ok: true, data: { op_id: "p1" } });
    expect(events).toEqual(["op.started", "op.done"]);
    expect(agent.log.list().map((e) => e.message.slice(0, 1))).toEqual(["⏳", "✅"]);
    expect(agent.log.list()[0]?.job_id).toBe("job-1");
  });

  it("noto'g'ri konvert AE'ga yuborilmaydi (AE_BAD_PARAMS)", async () => {
    const calls: string[] = [];
    const agent = createAgent({ evalScript: async (s) => (calls.push(s), "{}") });
    const outcome = await agent.runner.submit({ op: "comp.create", op_id: "c1", seq: 0 });
    expect(outcome.response).toMatchObject({ ok: false, error: { code: "AE_BAD_PARAMS" } });
    expect(calls).toEqual([]);
    expect(agent.log.list().at(-1)?.message).toMatch(/^❌/);
  });

  it("fayl yo'li ikki qatlamda tekshiriladi va AE'ga yuborilmaydi", async () => {
    const calls: string[] = [];
    const evalScript = async (s: string) => (calls.push(s), "{}");
    // 1) zod sxemasi: '..' va absolyut yo'l
    const traversal = await createAgent({ evalScript, root: "D:/reel" }).runner.submit(
      makeOp("item.import", "i1", 0, { file: "../x.mp4" }),
    );
    expect(traversal.response).toMatchObject({ ok: false, error: { code: "AE_BAD_PARAMS" } });
    // 2) ish papkasi tekshiruvi: papka tanlanmagan
    const noFolder = await createAgent({ evalScript, root: "" }).runner.submit(
      makeOp("item.import", "i2", 0, { file: "source/x.mp4" }),
    );
    expect(noFolder.response).toMatchObject({ ok: false, error: { code: "ENV_NO_FOLDER" } });
    expect(calls).toEqual([]);
  });

  it("javob kelmasa AE_TIMEOUT", async () => {
    const agent = createAgent({ evalScript: () => new Promise<string>(() => {}) });
    const outcome = await agent.runner.submit(makeOp("ping", "p1", 0, {}, { timeout_ms: 150 }));
    expect(outcome.response).toMatchObject({ ok: false, error: { code: "AE_TIMEOUT" } });
  });

  it("oplar qat'iy ketma-ket bajariladi", async () => {
    const order: string[] = [];
    const agent = createAgent({
      evalScript: async (script) => {
        const id = /op_id\\":\\"([a-z0-9]+)/.exec(script)?.[1] ?? "?";
        order.push("start:" + id);
        await new Promise((resolve) => setTimeout(resolve, id === "a" ? 60 : 5));
        order.push("end:" + id);
        return JSON.stringify({ ok: true, data: { op_id: id, reused: false } });
      },
    });
    await Promise.all([
      agent.runner.submit(makeOp("ping", "a", 0, {})),
      agent.runner.submit(makeOp("ping", "b", 1, {})),
    ]);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("jsx yuklanmagan bo'lsa $.evalFile bilan yuklab qayta urinadi", async () => {
    const h = await loadJsx(createMockAE({ files: { "C:/ext/jsx/index.js": {} } }), {
      preload: false,
    });
    const agent = createAgent({ evalScript: h.evalScript, jsxPath: "C:/ext/jsx/index.js" });
    const outcome = await agent.runner.submit(makeOp("ping", "p1", 0, {}));
    expect(outcome.response.ok).toBe(true);
  });

  it("jsx yo'q va yo'li ham berilmagan → AE_SCRIPT_ERROR; ExtendScript istisnosi → AE_SCRIPT_ERROR", async () => {
    const h = await loadJsx(undefined, { preload: false });
    const notLoaded = await createAgent({ evalScript: h.evalScript }).runner.submit(
      makeOp("ping", "p1", 0, {}),
    );
    expect(notLoaded.response).toMatchObject({ ok: false, error: { code: "AE_SCRIPT_ERROR" } });
    const broken = await createAgent({ evalScript: async () => "EvalScript error." }).runner.submit(
      makeOp("ping", "p2", 0, {}),
    );
    expect(broken.response).toMatchObject({ ok: false, error: { code: "AE_SCRIPT_ERROR" } });
  });
});

describe("script literal", () => {
  it("U+2028/2029 escape qilinadi (ES3 satrida qator oxiri)", () => {
    const literal = scriptLiteral("a\u2028b\u2029c");
    expect(literal).toBe('"a' + "\\" + "u2028b" + "\\" + 'u2029c"');
    expect(literal).not.toMatch(/[\u2028\u2029]/);
  });

  it("runOp skripti namespace mavjudligini tekshiradi", () => {
    const script = buildRunOpScript({ op: makeOp("ping", "p", 0, {}), ctx: { root: "D:/r" } });
    expect(script).toContain('typeof $["com.aestudio.panel"]');
    expect(script).toContain(".runOp(");
  });
});

describe("qayta ulanish kechikishi (backoff + jitter)", () => {
  it("eksponensial o'sadi, maksimumdan oshmaydi, ±20% jitter", async () => {
    const { reconnectDelay } = await import("../src/agent/ws-client");
    expect(reconnectDelay(0, 1000, 30_000, 0.5)).toBe(1000);
    expect(reconnectDelay(3, 1000, 30_000, 0.5)).toBe(8000);
    expect(reconnectDelay(10, 1000, 30_000, 0.5)).toBe(30_000);
    expect(reconnectDelay(0, 1000, 30_000, 0)).toBe(800);
    expect(reconnectDelay(0, 1000, 30_000, 1)).toBe(1200);
  });
});

describe("ffmpeg manbasi (P5.10)", () => {
  it("sozlama → ZXP ichidagi bin/<platform>-<arch> → PATH", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { bundledFfmpegDir, platformTag, resolveBinaries } = await import("../src/agent/ffmpeg");
    const exe = process.platform === "win32" ? ".exe" : "";
    const ext = mkdtempSync(nodePath.join(os.tmpdir(), "aes-ext-"));
    const agentDir = nodePath.join(ext, "agent");
    mkdirSync(agentDir);
    expect(bundledFfmpegDir(agentDir)).toBeNull();
    const bin = nodePath.join(ext, "bin", platformTag());
    mkdirSync(bin, { recursive: true });
    writeFileSync(nodePath.join(bin, `ffmpeg${exe}`), "");
    expect(bundledFfmpegDir(agentDir)).toBeNull();
    writeFileSync(nodePath.join(bin, `ffprobe${exe}`), "");
    expect(bundledFfmpegDir(agentDir)).toBe(bin);

    expect(resolveBinaries(null, bin).ffmpeg).toBe(nodePath.join(bin, `ffmpeg${exe}`));
    expect(resolveBinaries("C:/tools", bin).ffprobe).toBe(
      nodePath.join("C:/tools", `ffprobe${exe}`),
    );
    expect(resolveBinaries("", null)).toEqual({ ffmpeg: "ffmpeg", ffprobe: "ffprobe" });
  });

  it("bundle-ffmpeg: faqat LGPL build qabul qilinadi (Q9)", async () => {
    // @ts-expect-error — .mjs skript, tiplar yo'q
    const { licenseOf } = (await import("../scripts/bundle-ffmpeg.mjs")) as {
      licenseOf: (v: string) => { lgpl: boolean; gpl: boolean; nonfree: boolean };
    };
    expect(licenseOf("configuration: --enable-shared --enable-libopus").lgpl).toBe(true);
    expect(licenseOf("configuration: --enable-gpl --enable-libx264")).toMatchObject({
      gpl: true,
      lgpl: false,
    });
    expect(licenseOf("configuration: --enable-nonfree").lgpl).toBe(false);
  });
});

describe("birinchi ishga tushirish ustasi (P5.11)", () => {
  it("qadamlar: ulanish → papka → muhit → tayyor; muhit qatorlari", async () => {
    const { environmentItems, onboardingStep } = await import("../src/agent/onboarding");
    expect(onboardingStep({ paired: false, project: true, onboarded: true })).toBe("connect");
    expect(onboardingStep({ paired: true, project: false, onboarded: false })).toBe("folder");
    expect(onboardingStep({ paired: true, project: true, onboarded: false })).toBe("env");
    expect(onboardingStep({ paired: true, project: true, onboarded: true })).toBe("done");
    const items = environmentItems({
      ffmpeg: true,
      ffmpeg_source: "bundled",
      aerender: false,
      aerender_path: null,
      node: "v15.9.0",
    });
    expect(items.map((i) => [i.ok, i.label])).toEqual([
      [true, "ffmpeg/ffprobe (panel ichida)"],
      [false, "aerender topilmadi"],
      [true, "Node v15.9.0"],
    ]);
    expect(items[1]!.hint).toMatch(/Render Queue/);
  });
});

describe("jsx yuklash diagnostikasi", () => {
  it("yuklanmasa AE'dagi sabab (fayl yo'q / istisno) op xatosida ko'rinadi", async () => {
    const { createAeBridge } = await import("../src/agent/ae-bridge");
    const op = {
      op_id: "x",
      seq: 0,
      op: "ping",
      params: {},
      timeout_ms: 1000,
    } as never;
    // $[NS] yo'q; yuklash skripti ExtendScript ichida xatoni ushlab "ERR:..." qaytaradi.
    const replies = [
      "__AES_NOT_LOADED__",
      "ERR:fayl topilmadi: C:/x/jsx/index.js",
      "__AES_NOT_LOADED__",
    ];
    const seen: string[] = [];
    const bridge = createAeBridge({
      evalScript: async (script) => {
        seen.push(script);
        return replies.shift() ?? "__AES_NOT_LOADED__";
      },
      jsxPath: "C:/x/jsx/index.js",
    });
    const res = await bridge.runOp(op, { root: "" });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "AE_SCRIPT_ERROR", message: expect.stringContaining("fayl topilmadi") },
    });
    expect(seen[1]).toContain("try {");
    expect(seen[1]).toContain("$.evalFile(f)");
  });
});
