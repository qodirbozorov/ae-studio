/** P6.03: `AES.*` runtime — haqiqiy ES3 bundle mock AE'da; bridge versiya tekshiruvi. */
import { describe, expect, it } from "vitest";
import { makeOp } from "@aes/shared";
import { createAeBridge } from "../src/agent/ae-bridge";
import { JSX_VERSION, NS } from "../src/shared/constants";
import { KeyframeInterpolationType, createMockAE } from "./ae-mock";
import type { CompItem, MockProperty } from "./ae-mock";
import { loadJsx } from "./jsx-harness";
import type { Harness } from "./jsx-harness";

async function withBox(): Promise<{ h: Harness; prop: (match: string) => MockProperty }> {
  const h = await loadJsx(createMockAE());
  h.run("comp.create", "main.comp", { name: "MAIN", w: 1080, h: 1920, fps: 30, dur: 10 });
  h.run("layer.add_shape", "box", {
    comp: "main.comp",
    kind: "rect",
    color: "#FFFFFF",
    size: [10, 10],
    pos: [0, 0],
    start: 0,
  });
  const main = h.ae.app.project.itemsList.find((i) => i.name === "MAIN") as CompItem;
  return { h, prop: (match) => main.layer(1).transform(match) };
}

const PROP = (match: string) =>
  `app.project.item(1).layer(1).property("ADBE Transform Group").property("${match}")`;

describe("AES runtime (P6.03)", () => {
  it("global AES va $[NS].AES; versiya, hex, json, findComp/comp", async () => {
    const { h } = await withBox();
    expect(await h.evalScript("AES.version")).toBe(JSX_VERSION);
    expect(await h.evalScript(`$["${NS}"].AES === AES`)).toBe("true");
    expect(await h.evalScript('AES.json(AES.hex("#FF8000"))')).toBe("[1,0.5019607843137255,0]");
    expect(await h.evalScript('AES.findComp("MAIN").name')).toBe("MAIN");
    expect(await h.evalScript('AES.findComp("YOQ") === null')).toBe("true");
    expect(await h.evalScript('AES.comp("S01", 1080, 1920, 3, 30).name')).toBe("S01");
    expect(await h.evalScript('AES.comp("S01", 1, 1, 1, 1).width')).toBe("1080");
  });

  it("anim: setValuesAtTimes bir marta; segment ease (§11-B); spatial yo'l to'g'ri", async () => {
    const { h, prop } = await withBox();
    const n = await h.evalScript(
      `AES.anim(${PROP("ADBE Position")}, [[0, [0, 0]], [1, [300, 400], "enter"], [2, [300, 400], "hold"], [3, [0, 0]]], "linear")`,
    );
    expect(n).toBe("4");
    const position = prop("ADBE Position");
    expect(position.bulkWrites).toBe(1);
    const [k1, k2, k3, k4] = position.keys;
    // 0→1 enter: yo'l 500 px, T=1 → avg 500; out speed 6,25×, in speed 0.
    expect(k1!.outInterp).toBe(KeyframeInterpolationType.BEZIER);
    expect(k1!.outEase).toHaveLength(1);
    expect(k1!.outEase![0]!.speed).toBeCloseTo(3125, 3);
    expect(k1!.outEase![0]!.influence).toBeCloseTo(16, 3);
    expect(k2!.inEase![0]!.speed).toBe(0);
    expect(k2!.inEase![0]!.influence).toBeCloseTo(70, 3);
    // 1→2 hold; 2→3 linear.
    expect(k2!.outInterp).toBe(KeyframeInterpolationType.HOLD);
    expect(k3!.outInterp).toBe(KeyframeInterpolationType.LINEAR);
    expect(k4!.inInterp).toBe(KeyframeInterpolationType.LINEAR);
    expect(position.keys.every((k) => k.outTangent?.join() === "0,0")).toBe(true);
  });

  it("anim: Scale har o'lcham alohida (ishora bilan), rang tezligi 0, xom ease", async () => {
    const { h, prop } = await withBox();
    await h.evalScript(
      `AES.anim(${PROP("ADBE Scale")}, [[0, [100, 100, 100]], [0.5, [0, 200, 100], [0.34, 1.56, 0.64, 1]]], "linear")`,
    );
    const scale = prop("ADBE Scale").keys;
    expect(scale[0]!.outEase!.map((e) => Math.round(e.speed))).toEqual([-918, 918, 0]);
    expect(scale[1]!.inEase).toHaveLength(3);
    expect(scale[0]!.outTangent).toBeUndefined();

    await h.evalScript(
      `AES.anim(${PROP("ADBE Opacity")}, [[0, 0], [1, 100]], {in: [0, 80], out: [0, 20]})`,
    );
    const opacity = prop("ADBE Opacity").keys;
    expect(opacity[0]!.outEase![0]).toMatchObject({ speed: 0, influence: 20 });
    expect(opacity[1]!.inEase![0]).toMatchObject({ speed: 0, influence: 80 });
  });

  it("anim: noto'g'ri ease → AE_BAD_PARAMS istisnosi", async () => {
    const { h } = await withBox();
    expect(
      await h.evalScript(
        `(function(){ try { AES.anim(${PROP("ADBE Opacity")}, [[0, 0], [1, 1]], "bouncy"); return "ok"; } catch (e) { return e.aesCode; } })()`,
      ),
    ).toBe("AE_BAD_PARAMS");
  });

  it("prop.keyframes: token va kalitdagi ease runtime orqali; v1 ease o'zgarmagan", async () => {
    const { h, prop } = await withBox();
    const res = h.run("prop.keyframes", "box.in", {
      layer: "box",
      prop: "opacity",
      keys: [
        { t: 0, v: 0 },
        { t: 0.5, v: 100 },
        { t: 1, v: 50, ease: "hold" },
      ],
      ease: "$pop",
      relative: false,
    });
    expect(res).toMatchObject({ ok: true, data: { reused: false, info: { keys: 3 } } });
    const keys = prop("ADBE Opacity").keys;
    expect(keys[0]!.outEase![0]!.speed).toBeCloseTo((1.56 / 0.34) * 200, 2);
    expect(keys[1]!.outInterp).toBe(KeyframeInterpolationType.HOLD);
    expect(prop("ADBE Opacity").bulkWrites).toBe(1);

    h.run("prop.keyframes", "box.legacy", {
      layer: "box",
      prop: "rotation",
      keys: [
        { t: 0, v: 0 },
        { t: 1, v: 90 },
      ],
      ease: "ease_out",
      relative: false,
    });
    const rotation = prop("ADBE Rotate Z");
    expect(rotation.bulkWrites).toBe(0);
    expect(rotation.keys[0]!.outEase![0]!.influence).toBe(75);
  });

  it("dump: property daraxti chuqurlik bilan; saveVersion birinchi bo'sh versiya", async () => {
    const { h } = await withBox();
    const tree = JSON.parse(
      await h.evalScript(
        `AES.json(AES.dump(app.project.item(1).layer(1).property("ADBE Transform Group"), 1))`,
      ),
    ) as { match_name: string; children: { match_name: string; value?: unknown }[] };
    expect(tree.match_name).toBe("ADBE Transform Group");
    const opacity = tree.children.find((c) => c.match_name === "ADBE Opacity");
    expect(opacity?.value).toBe(100);

    h.ae.files.set("D:/Projects/reel/reel_v001.aep", {});
    expect(await h.evalScript('AES.saveVersion("D:/Projects/reel/", "reel")')).toMatch(
      /reel_v002\.aep$/,
    );
  });
});

describe("bridge: jsx versiyasi (P6.03)", () => {
  it("AE'da eski versiya qolgan bo'lsa qayta yuklaydi", async () => {
    const h = await loadJsx(createMockAE({ files: { "C:/ext/jsx/index.js": {} } }));
    // Eski panel yuklagan bundle: versiya boshqa.
    await h.evalScript(`$["${NS}"].version = "0.0.1"`);
    const bridge = createAeBridge({ evalScript: h.evalScript, jsxPath: "C:/ext/jsx/index.js" });
    const res = await bridge.runOp(makeOp("ping", "p", 0, {}), { root: "" });
    expect(res).toMatchObject({ ok: true, data: { info: { jsx_version: JSX_VERSION } } });
    expect(await h.evalScript(`$["${NS}"].version`)).toBe(JSX_VERSION);
  });

  it("qayta yuklangan fayl ham boshqa versiya bo'lsa — aniq xato", async () => {
    const replies = ["__AES_NOT_LOADED__", "v:0.0.1"];
    const bridge = createAeBridge({
      evalScript: async () => replies.shift() ?? "__AES_NOT_LOADED__",
      jsxPath: "C:/x/jsx/index.js",
    });
    const res = await bridge.runOp(makeOp("ping", "p", 0, {}), { root: "" });
    expect(res).toMatchObject({
      ok: false,
      error: { code: "AE_SCRIPT_ERROR", message: expect.stringContaining("0.0.1") },
    });
  });
});
