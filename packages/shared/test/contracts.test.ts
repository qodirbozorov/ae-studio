import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AeOpName, OpParamsMap } from "../src/ae";
import { parseBrand } from "../src/brand";
import type { IssueDetail } from "../src/common";
import { JOB_FLOW, JOB_STATES } from "../src/jobs";
import {
  OP_NAMES,
  OP_PATH_PARAMS,
  OP_PARAMS_SCHEMAS,
  makeOp,
  opTimeoutMs,
  parseOpEnvelope,
} from "../src/ops";
import { parseTemplateManifest } from "../src/template";
import {
  panelMessageSchema,
  parsePanelMessage,
  parseServerMessage,
  serverMessageSchema,
} from "../src/ws";
import templateExample from "./fixtures/template-plan-example.json";

const plan = readFileSync(new URL("../../../ae-studio-plan.md", import.meta.url), "utf8");

function section(title: string): string {
  const start = plan.indexOf(title);
  if (start < 0) throw new Error("Bo'lim topilmadi: " + title);
  const rest = plan.slice(start + title.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}

function paths(result: { ok: boolean; error?: { details?: unknown } }): string[] {
  if (result.ok) return [];
  return ((result.error?.details as IssueDetail[]) ?? []).map((d) => d.path);
}

/** Har op uchun bitta valid params namunasi. */
const VALID_PARAMS: { [N in AeOpName]: OpParamsMap[N] } = {
  ping: {},
  info: {},
  undo: { op_id: "hook.title" },
  "project.open_or_create": { path: "reel_v001.aep" },
  "project.save": { version: 2, path: "reel_v002.aep" },
  "item.import": { file: "source/clip_01.mp4", folder: "Source" },
  "comp.create": { name: "MAIN", w: 1080, h: 1920, fps: 30, dur: 12, bg: "#000000" },
  "comp.nest": { child: "s1.comp", parent: "main.comp", start: 0 },
  "layer.add_media": { comp: "s1.comp", item: "asset.clip_01", start: 0, fit: "cover" },
  "layer.add_text": {
    comp: "s1.comp",
    text: "3 ta xato",
    start: 0.2,
    style: { font: "Montserrat-Bold", size: 96, color: "#FFFFFF", justify: "center" },
    pos: [540, 960],
  },
  "layer.add_shape": {
    comp: "s1.comp",
    kind: "rect",
    color: "#FFCC00",
    size: [864, 120],
    pos: [540, 1500],
    start: 0,
    radius: 24,
  },
  "layer.add_audio": { comp: "main.comp", item: "asset.vo", start: 0, volume: 0 },
  "prop.keyframes": {
    layer: "s1.title",
    prop: "opacity",
    keys: [
      { t: 0, v: 0 },
      { t: 0.4, v: 100 },
    ],
    ease: "ease_out",
    relative: true,
  },
  "prop.expression": {
    layer: "s1.title",
    prop: "ADBE Transform Group/ADBE Position",
    expr_id: "wiggle",
    args: { freq: 2, amp: 10 },
  },
  "fx.apply_preset": { layer: "s1.title", ffx: "templates/fx/whip_left.ffx" },
  "fx.add": { layer: "s1.bg", matchName: "ADBE Gaussian Blur 2", params: { Blurriness: 20 } },
  "captions.build": {
    comp: "main.comp",
    words: [
      { text: "Salom", start: 0, end: 0.4 },
      { text: "dunyo", start: 0.4, end: 0.9 },
    ],
    style: "karaoke_bold",
    pos: [540, 1500],
    max_words: 4,
    box_w: 900,
  },
  "audio.duck": {
    music_layer: "music.layer",
    voice_layer: "vo.layer",
    amount_db: -12,
    segments: [{ start: 0, end: 4.2 }],
    fade: 0.25,
  },
  "template.instantiate": {
    template: "hook_title",
    file: "templates/hook_title/template.aep",
    slots: { title: "3 ta xato", bg: "asset:clip_01", accent: "#FF0055" },
    comp: "s1.comp",
    start: 0,
  },
  "frames.capture": { comp: "main.comp", times: [0.5, 3, 6.2], dir: "frames/job-1" },
  "render.queue": { comp: "main.comp", preset: "h264_social", out: "out/reel_v1.mp4" },
};

/** Har op uchun bitta noto'g'ri params va kutilgan xato path. */
const INVALID_PARAMS: { [N in AeOpName]: [unknown, string] } = {
  ping: [{ echo: 5 }, "/params/echo"],
  info: [{ x: 1 }, "/params"],
  undo: [{ op_id: "Bad Id" }, "/params/op_id"],
  "project.open_or_create": [{ path: "C:/x/a.aep" }, "/params/path"],
  "project.save": [{ version: 0, path: "a.aep" }, "/params/version"],
  "item.import": [{ file: "../secret.mp4" }, "/params/file"],
  "comp.create": [{ name: "M", w: 1080, h: 1920, fps: 30, dur: 0 }, "/params/dur"],
  "comp.nest": [{ child: "Bad Ref", parent: "p", start: 0 }, "/params/child"],
  "layer.add_media": [{ comp: "c", item: "i", start: 0, fit: "fill" }, "/params/fit"],
  "layer.add_text": [{ comp: "c", text: "", start: 0, style: {}, pos: [0, 0] }, "/params/text"],
  "layer.add_shape": [
    { comp: "c", kind: "star", color: "#fff000", size: [1, 1], pos: [0, 0], start: 0 },
    "/params/kind",
  ],
  "layer.add_audio": [{ comp: "c", item: "i", start: 0 }, "/params/volume"],
  "prop.keyframes": [
    { layer: "l", prop: "opacity", keys: [], ease: "linear", relative: true },
    "/params/keys",
  ],
  "prop.expression": [{ layer: "l", prop: "opacity", expr_id: "Wiggle!" }, "/params/expr_id"],
  "fx.apply_preset": [{ layer: "l", ffx: "/abs/x.ffx" }, "/params/ffx"],
  "fx.add": [{ layer: "l", matchName: "" }, "/params/matchName"],
  "captions.build": [
    { comp: "c", words: [], style: "s", pos: [0, 0], max_words: 4, box_w: 900 },
    "/params/words",
  ],
  "audio.duck": [
    { music_layer: "m", voice_layer: "v", amount_db: 6, segments: [], fade: 0.2 },
    "/params/amount_db",
  ],
  "template.instantiate": [
    { template: "t", file: "t.aep", slots: {}, comp: "c", start: -1 },
    "/params/start",
  ],
  "frames.capture": [{ comp: "c", times: [], dir: "frames" }, "/params/times"],
  "render.queue": [{ comp: "c", preset: "h264_social" }, "/params/out"],
};

describe("oplar ↔ asl reja §10.1", () => {
  it("OP_NAMES §10.1 jadvalidagi 18 ta op bilan aynan mos", () => {
    const table = section("### 10.1 Oplar (yopiq to'plam)");
    const fromPlan = [...table.matchAll(/^\| `([a-z_.]+)` \|/gm)].map((m) => m[1]);
    expect(fromPlan).toHaveLength(18);
    expect([...OP_NAMES].sort()).toEqual([...fromPlan].sort());
  });

  it("har op uchun params sxemasi bor", () => {
    for (const name of [...OP_NAMES, "ping"]) {
      expect(OP_PARAMS_SCHEMAS[name as AeOpName], name).toBeDefined();
    }
  });
});

describe("parseOpEnvelope", () => {
  for (const name of Object.keys(VALID_PARAMS) as AeOpName[]) {
    it(name + ": valid va noto'g'ri params", () => {
      const env = makeOp(name, "op-" + name.replace(/[^a-z]/g, "-"), 1, VALID_PARAMS[name]);
      const valid = parseOpEnvelope(env);
      if (!valid.ok) throw new Error(name + ": " + valid.error.message);

      const [badParams, badPath] = INVALID_PARAMS[name];
      const invalid = parseOpEnvelope({ ...env, params: badParams });
      expect(invalid.ok, name).toBe(false);
      expect(paths(invalid), name).toContain(badPath);
      if (!invalid.ok) expect(invalid.error.code).toBe("AE_BAD_PARAMS");
    });
  }

  it("noma'lum op, yomon op_id, ortiqcha kalit", () => {
    const base = makeOp("ping", "p1", 0, {});
    expect(paths(parseOpEnvelope({ ...base, op: "layer.delete" }))).toContain("/op");
    expect(paths(parseOpEnvelope({ ...base, op_id: "Has Space" }))).toContain("/op_id");
    expect(paths(parseOpEnvelope({ ...base, op_id: "a]b" }))).toContain("/op_id");
    expect(parseOpEnvelope({ ...base, extra: 1 }).ok).toBe(false);
  });

  it("makeOp default timeout'larni op bo'yicha qo'yadi", () => {
    expect(makeOp("ping", "p", 0, {}).timeout_ms).toBe(30_000);
    expect(opTimeoutMs("render.queue")).toBe(3_600_000);
    expect(makeOp("ping", "p", 0, {}, { timeout_ms: 500, scene_id: "s1" })).toMatchObject({
      timeout_ms: 500,
      scene_id: "s1",
    });
  });

  it("OP_PATH_PARAMS faqat mavjud params maydonlariga ishora qiladi", () => {
    for (const [op, fields] of Object.entries(OP_PATH_PARAMS)) {
      const sample = VALID_PARAMS[op as AeOpName] as Record<string, unknown>;
      for (const field of fields ?? [])
        expect(typeof sample[field], op + "." + field).toBe("string");
    }
  });
});

/** Har WS xabar turi uchun valid namuna. */
const SERVER_MESSAGES: Record<string, unknown> = {
  hello_ack: {
    type: "hello_ack",
    protocol_version: 1,
    server_version: "0.1.0",
    device_id: "dev-1",
    heartbeat_ms: 10000,
  },
  "op.run": { type: "op.run", job_id: "job-1", op: makeOp("ping", "p1", 0, {}) },
  "ops.batch": { type: "ops.batch", job_id: "job-1", ops: [makeOp("ping", "p1", 0, {})] },
  "asset.preview.request": {
    type: "asset.preview.request",
    request_id: "r1",
    local_path: "source/clip.mp4",
    mode: "frames",
    count: 3,
    max_px: 768,
    uploads: [{ url: "https://s3.example.com/a?sig=1", storage_key: "u/1/p/2/frames/a.jpg" }],
  },
  "audio.extract.request": {
    type: "audio.extract.request",
    request_id: "r2",
    local_path: "source/interview.mp4",
    format: "opus",
    mono: true,
    upload: { url: "https://s3.example.com/b", storage_key: "u/1/p/2/audio-in/b.opus" },
  },
  "file.download": {
    type: "file.download",
    request_id: "r3",
    url: "https://s3.example.com/c",
    sha256: "a".repeat(64),
    dest: "audio/vo.mp3",
  },
  "assets.scan": { type: "assets.scan", request_id: "r9", project_root: "D:/Projects/reel" },
  "project.open": { type: "project.open", request_id: "r10", root_path: "D:/Projects/reel" },
  "render.request": {
    type: "render.request",
    request_id: "r12",
    job_id: "job-1",
    project_path: "reel_v001.aep",
    comp: { op_id: "aes.main", name: "reel_v1" },
    out_base: "out/reel_v1_v001",
    preset: "h264_social",
    fps: 30,
    duration: 9.5,
  },
  "job.pause": { type: "job.pause", job_id: "job-1" },
  "job.cancel": { type: "job.cancel", job_id: "job-1" },
  "job.update": {
    type: "job.update",
    job_id: "job-1",
    state: "BUILD",
    prev_state: "PREFLIGHT",
    progress: { done: 3, total: 10 },
    scene_id: "s1",
  },
  "job.event": {
    type: "job.event",
    job_id: "job-1",
    event: {
      ts: "2026-10-05T04:00:00Z",
      level: "info",
      type: "op.done",
      message: "✅ comp.create",
    },
  },
  ping: { type: "ping", ts: 1 },
};

const PANEL_MESSAGES: Record<string, unknown> = {
  hello: {
    type: "hello",
    protocol_version: 1,
    panel_version: "0.1.0",
    device: { name: "Studio-PC", os: "Windows 10" },
    ae_version: "25.2",
    project_root: "D:/Projects/reel",
    running: null,
  },
  "op.started": { type: "op.started", job_id: "job-1", op_id: "p1", ts: 1 },
  "op.done": {
    type: "op.done",
    job_id: "job-1",
    op_id: "p1",
    result: { op_id: "p1", reused: false, target: { kind: "comp", id: 12, name: "MAIN" } },
    duration_ms: 120,
  },
  "op.failed": {
    type: "op.failed",
    job_id: "job-1",
    op_id: "p1",
    error: { code: "AE_TIMEOUT", retryable: true, hint: "..." },
    duration_ms: 30000,
  },
  log: { type: "log", level: "warn", message: "Shrift topilmadi" },
  "asset.scanned": {
    type: "asset.scanned",
    project_root: "D:/Projects/reel",
    assets: [
      {
        key: "clip_01",
        local_path: "source/clip_01.mp4",
        kind: "video",
        size: 1024,
        mtime_ms: 1,
        hash: "abc",
        meta: { duration: 3.2 },
      },
    ],
  },
  "file.uploaded": {
    type: "file.uploaded",
    request_id: "r1",
    storage_key: "u/1/p/2/frames/a.jpg",
    sha256: "b".repeat(64),
    size: 10,
  },
  "file.saved": {
    type: "file.saved",
    request_id: "r3",
    dest: "audio/vo.mp3",
    sha256: "c".repeat(64),
    size: 10,
  },
  "ae.state": { type: "ae.state", ae_version: "25.2", project_path: null, busy: false },
  "render.done": {
    type: "render.done",
    request_id: "r12",
    out: "out/reel_v1_v001.mp4",
    duration: 9.5,
    size: 123456,
    method: "aerender",
    encoder: "libx264",
  },
  "asset.preview.ready": {
    type: "asset.preview.ready",
    request_id: "r11",
    files: [{ storage_key: "u/a/p/b/frames/x.jpg", time: 1.5, size: 1000 }],
  },
  "project.opened": {
    type: "project.opened",
    request_id: "r10",
    project: { id: "p-1", name: "reel", root_path: "D:/Projects/reel" },
  },
  pong: { type: "pong", ts: 1 },
  "request.failed": {
    type: "request.failed",
    request_id: "r1",
    error: { code: "ASSET_MISSING", retryable: false, hint: "..." },
  },
};

describe("WS xabarlari ↔ asl reja §10.2", () => {
  const code = section("### 10.2 WebSocket xabarlari (server ↔ panel)").split("```")[1] ?? "";
  /** Yo'nalish bo'yicha xabar nomlari: `(…)` va `{…}` ichidagi maydonlar olib tashlanadi. */
  const listed = (direction: "server → panel" | "panel → server") => {
    const part = code
      .split(/(?=server → panel|panel → server)/)
      .find((p) => p.startsWith(direction));
    const body = (part ?? "")
      .slice(direction.length)
      .replace(/\([^)]*\)/g, "")
      .replace(/\{[^}]*\}/g, "");
    return body.split(/[,\s]+/).filter((token) => /^[a-z_]+(\.[a-z_]+)*$/.test(token));
  };

  it("§10.2 dagi server → panel xabarlarining hammasi sxemada bor", () => {
    const names = listed("server → panel");
    expect(names).toEqual(expect.arrayContaining(["hello_ack", "op.run", "file.download", "ping"]));
    for (const name of names) expect(Object.keys(SERVER_MESSAGES), name).toContain(name);
  });

  it("§10.2 dagi panel → server xabarlarining hammasi sxemada bor", () => {
    const names = listed("panel → server");
    expect(names).toEqual(expect.arrayContaining(["hello", "op.done", "asset.scanned", "pong"]));
    for (const name of names) expect(Object.keys(PANEL_MESSAGES), name).toContain(name);
  });

  it("namunalar sxemadagi barcha turlarni qamraydi", () => {
    expect(serverMessageSchema.options).toHaveLength(Object.keys(SERVER_MESSAGES).length);
    expect(panelMessageSchema.options).toHaveLength(Object.keys(PANEL_MESSAGES).length);
  });
});

describe("parseServerMessage / parsePanelMessage", () => {
  for (const [type, message] of Object.entries(SERVER_MESSAGES)) {
    it("server → panel: " + type, () => {
      const parsed = parseServerMessage(JSON.stringify(message));
      if (!parsed.ok) throw new Error(type + ": " + parsed.error.message);
      expect(parsed.data.type).toBe(type);
      const broken = { ...(message as Record<string, unknown>), unexpected: true };
      expect(parseServerMessage(broken).ok).toBe(false);
    });
  }

  for (const [type, message] of Object.entries(PANEL_MESSAGES)) {
    it("panel → server: " + type, () => {
      const parsed = parsePanelMessage(message);
      if (!parsed.ok) throw new Error(type + ": " + parsed.error.message);
      expect(parsed.data.type).toBe(type);
      const broken = { ...(message as Record<string, unknown>), unexpected: true };
      expect(parsePanelMessage(broken).ok).toBe(false);
    });
  }

  it("JSON bo'lmagan matn, noma'lum tur, noma'lum xato kodi, yomon sha256", () => {
    const notJson = parseServerMessage("{oops");
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) {
      expect(notJson.error.code).toBe("SYS_BAD_REQUEST");
      expect(notJson.error.message).toContain("JSON");
    }
    expect(paths(parsePanelMessage({ type: "op.teleport" }))).toContain("/type");
    const badCode = {
      ...(PANEL_MESSAGES["op.failed"] as Record<string, unknown>),
      error: { code: "NOPE", retryable: false, hint: "" },
    };
    expect(paths(parsePanelMessage(badCode))).toContain("/error/code");
    const badSha = { ...(SERVER_MESSAGES["file.download"] as object), sha256: "XYZ" };
    expect(paths(parseServerMessage(badSha))).toContain("/sha256");
  });
});

describe("shablon manifesti (§11.2)", () => {
  it("§11.2 namunasi valid", () => {
    const parsed = parseTemplateManifest(templateExample);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.data.slots.bg).toEqual({ type: "media", layer: "BG_PLACEHOLDER", fit: "cover" });
  });

  it("min > max va noma'lum slot turi rad etiladi", () => {
    const bad = JSON.parse(JSON.stringify(templateExample)) as Record<string, unknown>;
    bad.duration = { min: 6, max: 2, stretch: "time_remap" };
    (bad.slots as Record<string, unknown>).logo = { type: "image", layer: "LOGO" };
    const parsed = parseTemplateManifest(bad);
    expect(paths(parsed)).toEqual(expect.arrayContaining(["/duration", "/slots/logo/type"]));
  });
});

describe("brand kit (§11.3)", () => {
  const brand = {
    slug: "default",
    name: "Default",
    colors: { primary: "#FF0055" },
    fonts: { heading: { family: "Montserrat-Bold" }, body: { family: "Inter-Regular" } },
    logo: "asset:logo",
    voice: { voice_id: "abc123" },
  };

  it("default qiymatlar bilan valid", () => {
    const parsed = parseBrand(brand);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.data.colors.text).toBe("#FFFFFF");
    expect(parsed.data.fonts.heading.fallback).toEqual([]);
    expect(parsed.data.captions.style).toBe("karaoke_bold");
  });

  it("noto'g'ri rang va logo havolasi", () => {
    const parsed = parseBrand({ ...brand, colors: { primary: "pink" }, logo: "logo.png" });
    expect(paths(parsed)).toEqual(expect.arrayContaining(["/colors/primary", "/logo"]));
  });
});

describe("job holatlari (§3)", () => {
  it("asosiy zanjir §3 diagrammasi bilan bir xil tartibda", () => {
    const diagram = section("## 3. Holat mashinasi");
    const chain = diagram.match(/CHECK → [A-Z_ →]+DONE/)?.[0] ?? "";
    expect(chain.split(" → ")).toEqual([...JOB_FLOW]);
    expect(JOB_STATES).toEqual(expect.arrayContaining(["BLOCKED", "WAITING_AGENT"]));
  });
});
