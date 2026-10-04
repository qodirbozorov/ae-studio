import { describe, expect, it } from "vitest";
import type { IssueDetail } from "../src/common";
import {
  collectAssetRefs,
  parseSceneAnchor,
  parseSpec,
  parseVoRange,
  specJsonSchema,
} from "../src/spec";
import type { VideoSpec } from "../src/spec";
import planExample from "./fixtures/spec-plan-example.json";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Har testda toza nusxa. */
function example(): Record<string, unknown> {
  return clone(planExample) as Record<string, unknown>;
}

/** Minimal valid spec: bitta matnli sahna. */
function minimal(): Record<string, unknown> {
  return {
    version: 1,
    format: { w: 1080, h: 1920, fps: 30 },
    scenes: [{ id: "s1", dur: 3, layers: [{ type: "text", text: "Salom" }] }],
  };
}

function expectInvalid(input: unknown, path: string): IssueDetail[] {
  const result = parseSpec(input);
  if (result.ok) throw new Error("Spec valid bo'lib chiqdi, kutilgan xato path: " + path);
  expect(result.error.code).toBe("SPEC_INVALID");
  const details = result.error.details as IssueDetail[];
  expect(details.map((d) => d.path)).toContain(path);
  return details;
}

describe("parseSpec — valid", () => {
  it("§9 dagi namuna o'zgarishsiz valid", () => {
    const result = parseSpec(example());
    expect(result.ok).toBe(true);
  });

  it("default qiymatlar qo'yiladi", () => {
    const result = parseSpec(minimal());
    if (!result.ok) throw new Error(result.error.message);
    const spec: VideoSpec = result.data;
    expect(spec.format.duration).toBe("auto");
    expect(spec.variants).toEqual([]);
    expect(spec.brand).toBe("default");
    expect(spec.output).toEqual({ preset: "h264_social", name: "video" });
    const scene = spec.scenes[0]!;
    expect(scene.transition_out).toBe("none");
    const layer = scene.layers![0]!;
    if (layer.type !== "text") throw new Error("text layer kutilgan");
    expect(layer.anim).toBe("none");
    expect(layer.pos).toBe("center");
    expect(layer.max_width).toBe(0.9);
  });

  it("nisbiy pozitsiya, shape va audio layer, absolyut SFX vaqti", () => {
    const spec = minimal();
    spec.audio = {
      voiceover: { kind: "asset", asset: "asset:vo_take1" },
      sfx: [{ id: "pop1", asset: "asset:pop", at: 1.5 }],
    };
    spec.scenes = [
      {
        id: "intro",
        dur: 2.5,
        bg: "#101820",
        layers: [
          { type: "shape", kind: "rect", color: "#FFCC00", size: { w: 0.8, h: 0.1 } },
          { type: "text", text: "Hi", pos: { x: 0.5, y: 0.2 }, style: { size: 96 } },
          { type: "audio", src: "asset:ding", start: 0.5 },
        ],
      },
    ];
    expect(parseSpec(spec).ok).toBe(true);
  });
});

describe("parseSpec — xatolar aniq JSON Pointer path bilan", () => {
  it("version noto'g'ri", () => {
    const spec = minimal();
    spec.version = 2;
    expectInvalid(spec, "/version");
  });

  it("toq o'lcham (H.264 juft talab qiladi)", () => {
    const spec = minimal();
    spec.format = { w: 1081, h: 1920, fps: 30 };
    const details = expectInvalid(spec, "/format/w");
    expect(details.find((d) => d.path === "/format/w")?.message).toContain("juft");
  });

  it("fps 0", () => {
    const spec = minimal();
    spec.format = { w: 1080, h: 1920, fps: 0 };
    expectInvalid(spec, "/format/fps");
  });

  it("noma'lum kalit (strict) — xato kalit nomi ko'rsatiladi", () => {
    const spec = example();
    const scenes = spec.scenes as Record<string, unknown>[];
    scenes[0]!.transtion_out = "fade";
    const details = expectInvalid(spec, "/scenes/0");
    expect(details.some((d) => d.message.includes("transtion_out"))).toBe(true);
  });

  it("sahna id katta harf bilan", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.id = "S1";
    expectInvalid(spec, "/scenes/0/id");
  });

  it("takrorlangan sahna id", () => {
    const spec = minimal();
    const scenes = spec.scenes as unknown[];
    scenes.push(clone(scenes[0]));
    expectInvalid(spec, "/scenes/1/id");
  });

  it("vo: oralig'ida a >= b", () => {
    const spec = example();
    (spec.scenes as Record<string, unknown>[])[0]!.dur = "vo:3-1";
    expectInvalid(spec, "/scenes/0/dur");
  });

  it("vo: davomiylik, lekin voiceover yo'q", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.dur = "vo:0-1";
    expectInvalid(spec, "/scenes/0/dur");
  });

  it("vo: oraliqlari uzluksiz emas (0-1, keyin 2-3)", () => {
    const spec = example();
    (spec.scenes as Record<string, unknown>[])[1]!.dur = "vo:2-3";
    expectInvalid(spec, "/scenes/1/dur");
  });

  it("sahnada na template, na layer", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.layers = [];
    expectInvalid(spec, "/scenes/0/layers");
  });

  it("slots template'siz", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.slots = { title: "x" };
    expectInvalid(spec, "/scenes/0/slots");
  });

  it("noma'lum layer turi", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.layers = [{ type: "video", src: "asset:a" }];
    const details = expectInvalid(spec, "/scenes/0/layers/0/type");
    expect(details[0]!.message).toContain("media, text, shape, audio");
  });

  it("asset havolasi prefikssiz", () => {
    const spec = example();
    const scenes = spec.scenes as { layers?: Record<string, unknown>[] }[];
    scenes[1]!.layers![0]!.src = "photo_02";
    expectInvalid(spec, "/scenes/1/layers/0/src");
  });

  it("noma'lum animatsiya va transition", () => {
    const spec = example();
    const scenes = spec.scenes as Record<string, unknown>[];
    (scenes[1]!.layers as Record<string, unknown>[])[0]!.anim = "spin";
    scenes[0]!.transition_out = "teleport";
    expectInvalid(spec, "/scenes/1/layers/0/anim");
    expectInvalid(spec, "/scenes/0/transition_out");
  });

  it("noto'g'ri rang", () => {
    const spec = minimal();
    (spec.scenes as Record<string, unknown>[])[0]!.bg = "red";
    expectInvalid(spec, "/scenes/0/bg");
  });

  it("SFX noma'lum sahnaga langar qilingan", () => {
    const spec = example();
    const audio = spec.audio as { sfx: Record<string, unknown>[] };
    audio.sfx[0]!.at = "s9.end";
    expectInvalid(spec, "/audio/sfx/0/at");
  });

  it("SFX'da prompt ham, asset ham", () => {
    const spec = example();
    const audio = spec.audio as { sfx: Record<string, unknown>[] };
    audio.sfx[0]!.asset = "asset:whoosh";
    expectInvalid(spec, "/audio/sfx/0");
  });

  it("captions voiceover'dan, lekin voiceover yo'q; duck_under ham voiceover talab qiladi", () => {
    const spec = example();
    const audio = spec.audio as Record<string, unknown>;
    delete audio.voiceover;
    (spec.scenes as Record<string, unknown>[]).forEach((scene, i) => (scene.dur = i + 2));
    expectInvalid(spec, "/audio/captions/from");
    expectInvalid(spec, "/audio/music/duck_under");
  });

  it("tts_timestamps TTS bo'lmagan manba bilan", () => {
    const spec = example();
    const audio = spec.audio as Record<string, Record<string, unknown>>;
    audio.captions = { from: "source_audio", method: "tts_timestamps" };
    expectInvalid(spec, "/audio/captions/method");
  });

  it("takrorlangan variant", () => {
    const spec = example();
    spec.variants = ["9:16", "9:16"];
    expectInvalid(spec, "/variants");
  });

  it("xabarlar o'zbekcha va xulosa message'da", () => {
    const spec = minimal();
    spec.format = { w: "1080", h: 1920, fps: 30 };
    const result = parseSpec(spec);
    if (result.ok) throw new Error("xato kutilgan");
    expect(result.error.message).toMatch(/^1 ta xato: \/format\/w — /);
    expect(result.error.message).toContain("kutilgan");
    expect(result.error.hint).toContain("plan_patch");
  });
});

describe("yordamchilar", () => {
  it("parseVoRange", () => {
    expect(parseVoRange("vo:1-3")).toEqual({ from: 1, to: 3 });
    expect(parseVoRange("vo:1")).toBeNull();
    expect(parseVoRange("3")).toBeNull();
  });

  it("parseSceneAnchor", () => {
    expect(parseSceneAnchor("s1.end")).toEqual({ scene: "s1", edge: "end", offset: 0 });
    expect(parseSceneAnchor("intro.start+0.5")).toEqual({
      scene: "intro",
      edge: "start",
      offset: 0.5,
    });
    expect(parseSceneAnchor("s2.end-0.25")).toEqual({ scene: "s2", edge: "end", offset: -0.25 });
    expect(parseSceneAnchor("s2.middle")).toBeNull();
  });

  it("collectAssetRefs §9 namunasi uchun", () => {
    const result = parseSpec(example());
    if (!result.ok) throw new Error(result.error.message);
    expect(collectAssetRefs(result.data)).toEqual(["interview_01", "clip_01", "photo_02"]);
  });
});

describe("specJsonSchema", () => {
  it("MCP inputSchema uchun JSON Schema (strict, kiritish shakli)", () => {
    const schema = specJsonSchema() as {
      type: string;
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["version", "format", "scenes"]));
    expect(schema.required).not.toContain("output");
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["format", "variants", "brand", "audio", "scenes", "output"]),
    );
    expect(specJsonSchema()).toBe(specJsonSchema());
  });
});
