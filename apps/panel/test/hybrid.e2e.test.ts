/** Gibrid usul: spec → kompilyator (skript op'lari, hook tartibi) → ExtendScript (mock AE) `jsx.run`. */
import { compile, expandExpression, scriptParams } from "@aes/compiler";
import { parseSpec } from "@aes/shared";
import { describe, expect, it } from "vitest";
import { CONTEXT } from "../../../packages/compiler/test/fixtures";
import { createMockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

const ROOT = "D:/Projects/reel";

const SPEC = {
  version: 1,
  format: { w: 1080, h: 1920, fps: 30 },
  output: { name: "hyb" },
  scenes: [
    {
      id: "stat",
      dur: 2,
      layers: [
        {
          type: "text",
          id: "title",
          text: "Tezroq.",
          presets: [{ name: "wan apple opacity blur in", at: 0.2 }],
          expressions: { scale: "lib:inertial_bounce(0.05,4,8)" },
          text_anim: { by: "words", preset: "word_bounce", stagger: 0.08 },
        },
        { type: "text", id: "num", text: "0" },
      ],
    },
  ],
  scripts: [
    {
      id: "num_count",
      lib: "counter",
      hook: "after_scene:stat",
      args: { layer: "num", to: 300, suffix: "%" },
    },
    { id: "fix_1", code: "return AES.version;", hook: "after_build" },
  ],
};

describe("gibrid skriptlar", () => {
  it("kompilyator: preset/expression/text_anim/scripts op'lari hook tartibida", () => {
    const spec = parseSpec(SPEC);
    if (!spec.ok) throw new Error(JSON.stringify(spec.error.details));
    const out = compile(spec.data, CONTEXT);
    if (!out.ok) throw new Error(out.error.message);
    const ids = out.data.ops.map((op) => op.op_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "stat.title.x0",
        "stat.title.preset0",
        "stat.title.textanim",
        "script.num_count",
        "script.fix_1",
      ]),
    );
    // after_scene — sahna nest'idan oldin; after_build — yakuniy saqlashdan oldin.
    expect(ids.indexOf("script.num_count")).toBeLessThan(ids.indexOf("stat.nest"));
    expect(ids.indexOf("script.fix_1")).toBe(ids.indexOf("aes.save") - 1);
    const count = out.data.ops.find((op) => op.op_id === "script.num_count")!;
    expect(count.params).toMatchObject({
      args: { __comp: "01_stat", __ref: "stat.num", to: 300 },
      once: true,
    });
    const raw = out.data.ops.find((op) => op.op_id === "script.fix_1")!;
    expect(raw.params).toMatchObject({ raw: true });
    expect(expandExpression("lib:inertial_bounce(0.05,4,8)")).toMatchObject({ ok: true });
    expect(expandExpression("lib:nope()")).toMatchObject({ ok: false });
    expect(scriptParams({ code: 'system.callSystem("del x")' })).toMatchObject({
      ok: false,
      error: { code: "SCRIPT_UNSAFE" },
    });
  });

  it("jsx.run: natija, xato job'ni to'xtatmaydi (qator bilan), once — qayta bajarilmaydi, preset topilmadi", async () => {
    const h = await loadJsx(createMockAE());
    const run = (opId: string, params: object) =>
      h.run("jsx.run", opId, params as never, { root: ROOT });
    expect(
      run("s.ok", {
        code: "return { v: args.a * 2, ver: AES.version };",
        args: { a: 21 },
        once: true,
      }),
    ).toMatchObject({
      ok: true,
      data: { reused: false, info: { ok: true, result: { v: 42 } } },
    });
    expect(run("s.ok", { code: "return 1;", once: true })).toMatchObject({
      data: { reused: true },
    });
    const bad = run("s.bad", { code: "var x = 1;\nnull.foo();" });
    expect(bad).toMatchObject({ ok: true, data: { info: { ok: false } } });
    h.run("comp.create", "c", { name: "01_stat", w: 100, h: 100, fps: 30, dur: 2 });
    h.run("layer.add_text", "stat.title", {
      comp: "c",
      text: "Tezroq.",
      start: 0,
      style: {},
      pos: [50, 50],
    });
    const preset = run("s.preset", {
      code: scriptParams({ lib: "apply_preset" }).ok
        ? (scriptParams({ lib: "apply_preset" }) as { data: { code: string } }).data.code
        : "",
      args: { __ref: "stat.title", name: "yo'q preset" },
    });
    expect(preset).toMatchObject({ ok: true, data: { info: { ok: false } } });
    expect(JSON.stringify(preset)).toContain("Preset topilmadi");
  });
});
