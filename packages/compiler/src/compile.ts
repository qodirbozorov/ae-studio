/**
 * Video Spec → oplist (§9 → §10.1). Sof va deterministik funksiya: bir xil Spec va kontekst → bir xil oplar.
 *
 * Tuzilma: loyiha → importlar → asosiy comp → har sahna: comp + layerlar (+ animatsiya) → nest
 * (+ o'tish) → saqlash. op_id'lar Spec'dagi barqaror nomlardan (sahna id, layer id/indeks) yasaladi:
 * resume'da AE'dagi iz bo'yicha bajarilganlar qayta yaratilmaydi, patch'da faqat o'zgargan qism yangilanadi.
 */
import { fail, makeOp, ok } from "@aes/shared";
import type {
  AeOpName,
  Layer,
  OpEnvelope,
  OpParamsMap,
  Result,
  Scene,
  TextStyle,
  TextStyleOp,
  VideoSpec,
} from "@aes/shared";
import { fitScale, round, toPixels } from "./layout";
import type { Frame } from "./layout";
import { animOps, transitionOps } from "./motion";
import type { MotionOp } from "./motion";

export interface CompileAsset {
  key: string;
  local_path: string;
  kind: "video" | "image" | "audio" | "other";
  status?: "ok" | "corrupt" | "unsupported" | "missing";
  meta: { width?: number | null; height?: number | null; duration?: number | null };
}

export interface CompileContext {
  /** INGEST natijasi: kalit → asset. */
  assets: Record<string, CompileAsset>;
  /**
   * Quriladigan versiya fayli (`<nom>_vNNN.aep`, ish papkasiga nisbiy). Build shu faylga yoziladi:
   * mavjud bo'lsa ochiladi, bo'lmasa yaratiladi; har sahnadan keyin va oxirida shu yo'lga saqlanadi —
   * AE o'rtada yopilsa, saqlangan joydan iz bo'yicha dublikatsiz davom etadi (§2.5, §2.10).
   */
  projectPath: string;
  version: number;
  /** TTS-first timing natijasi (Faza 4): sahna id → soniya. Berilsa `dur` o'rniga ishlatiladi. */
  sceneDurations?: Record<string, number>;
}

export interface CompiledScene {
  id: string;
  start: number;
  duration: number;
  comp: string;
}

export interface CompileOutput {
  ops: OpEnvelope[];
  scenes: CompiledScene[];
  duration: number;
  /** Asosiy comp'ning op_id si (VERIFY va RENDER shunga murojaat qiladi). */
  mainComp: string;
  /** VERIFY uchun kadr vaqtlari (§3). */
  keyTimes: number[];
  warnings: string[];
}

export const MAIN_COMP = "aes.main";
const SOURCE_FOLDER = "Source";
const SCENES_FOLDER = "Scenes";

class OpList {
  readonly ops: OpEnvelope[] = [];
  add<N extends AeOpName>(op: N, opId: string, params: OpParamsMap[N], sceneId?: string): string {
    const extra = sceneId === undefined ? {} : { scene_id: sceneId };
    this.ops.push(makeOp(op, opId, this.ops.length, params, extra) as OpEnvelope);
    return opId;
  }
  motion(ops: MotionOp[], prefix: string, sceneId?: string): void {
    for (const m of ops) this.add(m.op, `${prefix}.${m.suffix}`, m.params as never, sceneId);
  }
}

function sceneDuration(scene: Scene, index: number, ctx: CompileContext): Result<number> {
  const override = ctx.sceneDurations?.[scene.id];
  if (override !== undefined) return ok(override);
  if (typeof scene.dur === "number") return ok(scene.dur);
  return fail(
    "SPEC_INVALID",
    `/scenes/${index}/dur: '${scene.dur}' voiceover vaqtlari hisoblangandan keyin aniqlanadi (TTS-first timing)`,
  );
}

function textStyle(style: TextStyle, frame: Frame): TextStyleOp {
  const op: TextStyleOp = {
    size: style.size ?? Math.round(frame.h * 0.045),
    color: style.color ?? "#FFFFFF",
    justify: style.align ?? "center",
  };
  if (style.font !== undefined) op.font = style.font;
  if (style.stroke_color !== undefined) op.stroke_color = style.stroke_color;
  if (style.stroke_width !== undefined) op.stroke_width = style.stroke_width;
  if (style.all_caps !== undefined) op.all_caps = style.all_caps;
  return op;
}

function refKey(ref: string): string {
  return ref.slice("asset:".length);
}

/** Spec'dagi media/audio havolalari: mavjud va yaroqli bo'lishi kerak (PLAN/PREFLIGHT gate'i). */
function checkAssets(spec: VideoSpec, ctx: CompileContext): Result<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const [i, scene] of spec.scenes.entries()) {
    for (const [j, layer] of (scene.layers ?? []).entries()) {
      if (layer.type !== "media" && layer.type !== "audio") continue;
      const key = refKey(layer.src);
      const asset = ctx.assets[key];
      const path = `/scenes/${i}/layers/${j}/src`;
      if (asset === undefined) return fail("SPEC_UNKNOWN_ASSET", `${path}: asset:${key} topilmadi`);
      if (asset.status === "missing")
        return fail("ASSET_MISSING", `${path}: ${asset.local_path} yo'q`);
      if (asset.status === "corrupt")
        return fail("ASSET_CORRUPT", `${path}: ${asset.local_path} buzilgan`);
      if (asset.status === "unsupported" || asset.kind === "other") {
        return fail("ASSET_UNSUPPORTED", `${path}: ${asset.local_path}`);
      }
      if (layer.type === "media" && asset.kind === "audio") {
        return fail(
          "SPEC_INVALID",
          `${path}: audio fayl media layer bo'la olmaydi (type: "audio" ishlating)`,
        );
      }
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return ok(keys);
}

export function compile(spec: VideoSpec, ctx: CompileContext): Result<CompileOutput> {
  const frame: Frame = { w: spec.format.w, h: spec.format.h };
  const fps = spec.format.fps;
  const warnings: string[] = [];

  for (const [i, scene] of spec.scenes.entries()) {
    if (scene.template !== undefined) {
      return fail(
        "SPEC_UNKNOWN_TEMPLATE",
        `/scenes/${i}/template: shablonlar hali ulanmagan (${scene.template})`,
      );
    }
  }

  // Sahna vaqtlari
  const timing: CompiledScene[] = [];
  let cursor = 0;
  for (const [i, scene] of spec.scenes.entries()) {
    const dur = sceneDuration(scene, i, ctx);
    if (!dur.ok) return dur;
    timing.push({
      id: scene.id,
      start: round(cursor),
      duration: round(dur.data),
      comp: `${scene.id}.comp`,
    });
    cursor += dur.data;
  }
  const scenesTotal = round(cursor);
  let duration = scenesTotal;
  if (spec.format.duration !== "auto") {
    duration = spec.format.duration;
    if (Math.abs(duration - scenesTotal) > 1 / fps) {
      warnings.push(
        `format.duration (${duration} s) sahnalar yig'indisidan (${scenesTotal} s) farq qiladi`,
      );
    }
  }

  const assets = checkAssets(spec, ctx);
  if (!assets.ok) return assets;

  const list = new OpList();
  const save = { version: ctx.version, path: ctx.projectPath };
  list.add("project.open_or_create", "aes.project", { path: ctx.projectPath });
  for (const key of assets.data) {
    list.add("item.import", `asset.${key}`, {
      file: ctx.assets[key]!.local_path,
      folder: SOURCE_FOLDER,
    });
  }
  list.add("comp.create", MAIN_COMP, {
    name: spec.output.name,
    w: frame.w,
    h: frame.h,
    fps,
    dur: duration,
    bg: "#000000",
  });

  for (const [i, scene] of spec.scenes.entries()) {
    const time = timing[i]!;
    const comp = list.add(
      "comp.create",
      time.comp,
      {
        name: `${String(i + 1).padStart(2, "0")}_${scene.id}`,
        w: frame.w,
        h: frame.h,
        fps,
        dur: time.duration,
        bg: scene.bg ?? "#000000",
        folder: SCENES_FOLDER,
      },
      scene.id,
    );
    for (const [j, layer] of (scene.layers ?? []).entries()) {
      compileLayer(
        list,
        layer,
        `${scene.id}.${layer.id ?? `l${j}`}`,
        comp,
        time,
        scene.id,
        frame,
        ctx,
        warnings,
      );
    }
    const nest = list.add(
      "comp.nest",
      `${scene.id}.nest`,
      { child: comp, parent: MAIN_COMP, start: time.start, dur: time.duration, name: scene.id },
      scene.id,
    );
    list.motion(
      transitionOps(scene.transition_out, nest, time.start + time.duration, frame),
      nest,
      scene.id,
    );
    // Oraliq saqlash: resume'da bajarilgan sahnalar diskda bo'ladi.
    list.add("project.save", `${scene.id}.save`, save, scene.id);
  }

  list.add("project.save", "aes.save", save);

  return ok({
    ops: list.ops,
    scenes: timing,
    duration,
    mainComp: MAIN_COMP,
    keyTimes: keyTimes(timing, duration),
    warnings,
  });
}

function compileLayer(
  list: OpList,
  layer: Layer,
  opId: string,
  comp: string,
  time: CompiledScene,
  sceneId: string,
  frame: Frame,
  ctx: CompileContext,
  warnings: string[],
): void {
  const start = layer.start ?? 0;
  if (start >= time.duration) {
    warnings.push(`${opId}: start (${start}) sahna davomiyligidan katta — layer ko'rinmaydi`);
  }
  const dur = round(
    Math.max(0.01, Math.min(layer.dur ?? time.duration - start, time.duration - start)),
  );
  const timingParams = layer.dur === undefined ? { start } : { start, dur };

  switch (layer.type) {
    case "media": {
      const asset = ctx.assets[refKey(layer.src)]!;
      const pos = toPixels(layer.pos, frame);
      const params: OpParamsMap["layer.add_media"] = {
        comp,
        item: `asset.${asset.key}`,
        ...timingParams,
        fit: layer.fit,
        pos,
      };
      if (layer.opacity !== 100) params.opacity = layer.opacity;
      if (layer.keep_audio) params.keep_audio = true;
      list.add("layer.add_media", opId, params, sceneId);
      const clip = asset.meta.duration ?? null;
      if (asset.kind === "video" && clip !== null && clip + 1e-6 < dur) {
        warnings.push(`${opId}: video (${clip} s) layer'dan (${dur} s) qisqa`);
      }
      list.motion(
        animOps(
          layer.anim,
          { layer: opId, kind: "media", pos, scale: fitScale(layer.fit, asset.meta, frame), dur },
          frame,
        ),
        opId,
        sceneId,
      );
      return;
    }
    case "text": {
      const pos = toPixels(layer.pos, frame);
      list.add(
        "layer.add_text",
        opId,
        { comp, text: layer.text, ...timingParams, style: textStyle(layer.style, frame), pos },
        sceneId,
      );
      list.motion(
        animOps(layer.anim, { layer: opId, kind: "text", pos, scale: [100, 100], dur }, frame),
        opId,
        sceneId,
      );
      return;
    }
    case "shape": {
      const pos = toPixels(layer.pos, frame);
      const params: OpParamsMap["layer.add_shape"] = {
        comp,
        kind: layer.kind,
        color: layer.color,
        size: [round(layer.size.w * frame.w), round(layer.size.h * frame.h)],
        pos,
        ...timingParams,
      };
      if (layer.radius > 0) params.radius = layer.radius;
      if (layer.opacity !== 100) params.opacity = layer.opacity;
      list.add("layer.add_shape", opId, params, sceneId);
      list.motion(
        animOps(layer.anim, { layer: opId, kind: "shape", pos, scale: [100, 100], dur }, frame),
        opId,
        sceneId,
      );
      return;
    }
    case "audio": {
      list.add(
        "layer.add_audio",
        opId,
        { comp, item: `asset.${refKey(layer.src)}`, ...timingParams, volume: layer.volume_db },
        sceneId,
      );
      return;
    }
  }
}

/** VERIFY kadrlari: har sahnada animatsiyadan keyin, o'rtasi va oxiri (o'tishdan oldin). */
export function keyTimes(scenes: CompiledScene[], total: number): number[] {
  const times = new Set<number>();
  const clamp = (t: number) => Math.min(Math.max(0, t), Math.max(0, total - 0.05));
  for (const s of scenes) {
    times.add(round(clamp(s.start + Math.min(0.6, s.duration / 3))));
    times.add(round(clamp(s.start + s.duration / 2)));
    times.add(round(clamp(s.start + s.duration - Math.min(0.4, s.duration / 4))));
  }
  return [...times].sort((a, b) => a - b);
}
