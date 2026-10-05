import { makeOp } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { buildRunOpScript, scriptLiteral } from "../src/agent/ae-bridge";
import { createAgent } from "../src/agent/index";
import type { RunnerEvent } from "../src/agent/op-runner";
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
    const h = await loadJsx(undefined, { preload: false });
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
