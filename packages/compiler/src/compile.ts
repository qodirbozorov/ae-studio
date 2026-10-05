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
  TextStyle,
  TextStyleOp,
  VideoSpec,
} from "@aes/shared";
import { fitScale, round, toPixels } from "./layout";
import type { Frame } from "./layout";
import { animOps, transitionOps } from "./motion";
import type { MotionOp } from "./motion";
import { expandTemplate } from "./template";
import type { CompileTemplate, ExpandedTemplate, TokenValue } from "./template";
import { planTiming, resolveAt, shiftWords, voiceSegments } from "./timing";
import type { CaptionWord } from "@aes/shared";

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
  /** Sahna id → soniya (qo'lda override). Berilsa `dur` o'rniga ishlatiladi. */
  sceneDurations?: Record<string, number>;
  /** AUDIO holati natijasi (Faza 4): ish papkasidagi fayllar va so'z vaqtlari. */
  audio?: CompileAudio;
  /** Spec'dagi shablonlar (§11.2): slug → manifest (+ aep fayli). */
  templates?: Record<string, CompileTemplate>;
  /** Recipe shablonlari uchun qo'shimcha tokenlar (`brand.*`, P5.04). */
  tokens?: Record<string, TokenValue>;
}

/** AUDIO natijalari (fayllar ish papkasiga nisbiy; so'z vaqtlari audio boshiga nisbatan). */
export interface CompileAudio {
  voiceover?: { file: string; words: CaptionWord[]; duration: number | null };
  music?: { file: string };
  /** SFX id → generatsiya qilingan fayl (asset SFX lar `assets` dan). */
  sfx?: Record<string, { file: string }>;
  source?: { isolatedFile?: string; words?: CaptionWord[] };
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

/**
 * Matn `max_width` ga sig'masa paragraf qutisi (AE `addBoxText`, markazi `pos` da): eni `max_width`, balandligi
 * taxminiy qatorlar soni bo'yicha. Kenglik taxmini: belgi ≈ 0.55 × o'lcham (katta harf 0.65). Sig'sa — nuqtali matn.
 */
export function textBox(
  text: string,
  style: TextStyleOp,
  maxWidth: number,
  frame: Frame,
): [number, number] | null {
  const size = style.size ?? Math.round(frame.h * 0.045);
  const upper = style.all_caps === true || text === text.toUpperCase();
  const estimate = text.length * size * (upper ? 0.65 : 0.55);
  const width = Math.round(maxWidth * frame.w);
  if (estimate <= width) return null;
  const lines = Math.ceil(estimate / width) + (text.includes("\n") ? 1 : 0);
  return [width, Math.round(lines * size * 1.3 + size * 0.4)];
}

function refKey(ref: string): string {
  return ref.slice("asset:".length);
}

/** Spec'dagi media/audio havolalari: mavjud va yaroqli bo'lishi kerak (PLAN/PREFLIGHT gate'i). */
function checkAssets(
  spec: VideoSpec,
  ctx: CompileContext,
  expansions: (ExpandedTemplate | null)[],
): Result<string[]> {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const [i, scene] of spec.scenes.entries()) {
    const expansion = expansions[i] ?? null;
    for (const key of expansion?.assets ?? []) {
      const asset = ctx.assets[key];
      const path = `/scenes/${i}/slots`;
      if (asset === undefined) return fail("SPEC_UNKNOWN_ASSET", `${path}: asset:${key} topilmadi`);
      if (asset.status !== undefined && asset.status !== "ok") {
        return fail("ASSET_MISSING", `${path}: asset:${key} holati ${asset.status}`);
      }
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
    const entries: [Layer, string][] = [
      ...(expansion?.layers ?? []).map((layer, j): [Layer, string] => [
        layer,
        `/scenes/${i}/template (layer ${j})`,
      ]),
      ...(scene.layers ?? []).map((layer, j): [Layer, string] => [
        layer,
        `/scenes/${i}/layers/${j}/src`,
      ]),
    ];
    for (const [layer, path] of entries) {
      if (layer.type !== "media" && layer.type !== "audio") continue;
      const key = refKey(layer.src);
      const asset = ctx.assets[key];
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

  // Sahna vaqtlari (TTS-first: `vo:a-b` voiceover gaplaridan)
  const vo = ctx.audio?.voiceover;
  const planned = planTiming(
    spec,
    vo === undefined ? null : { words: vo.words, duration: vo.duration },
    ctx.sceneDurations ?? {},
  );
  if (!planned.ok) return planned;
  const timing: CompiledScene[] = planned.data.scenes.map((scene) => ({
    ...scene,
    comp: `${scene.id}.comp`,
  }));
  const scenesTotal = planned.data.total;
  let duration = scenesTotal;
  if (spec.format.duration !== "auto") {
    duration = spec.format.duration;
    if (Math.abs(duration - scenesTotal) > 1 / fps) {
      warnings.push(
        `format.duration (${duration} s) sahnalar yig'indisidan (${scenesTotal} s) farq qiladi`,
      );
    }
  }

  // Shablonli sahnalar: recipe → layerlar, aep → template.instantiate (§11.2).
  const expansions: (ExpandedTemplate | null)[] = [];
  for (const [i, scene] of spec.scenes.entries()) {
    if (scene.template === undefined) {
      expansions.push(null);
      continue;
    }
    const expanded = expandTemplate(
      scene,
      i,
      ctx.templates ?? {},
      frame,
      timing[i]!.duration,
      ctx.tokens ?? {},
    );
    if (!expanded.ok) return expanded;
    warnings.push(...expanded.data.warnings);
    expansions.push(expanded.data);
  }

  const assets = checkAssets(spec, ctx, expansions);
  if (!assets.ok) return assets;
  const audioSpec = spec.audio;
  // Spec audio'dagi asset havolalari (musiqa, SFX, manba, tayyor voiceover) ham import qilinadi.
  const audioRefs: string[] = [];
  if (audioSpec?.voiceover?.kind === "asset") audioRefs.push(audioSpec.voiceover.asset);
  if (audioSpec?.music?.kind === "asset") audioRefs.push(audioSpec.music.asset);
  for (const sfx of audioSpec?.sfx ?? []) if (sfx.asset !== undefined) audioRefs.push(sfx.asset);
  for (const ref of audioRefs) {
    const key = refKey(ref);
    const asset = ctx.assets[key];
    if (asset === undefined) return fail("SPEC_UNKNOWN_ASSET", `/audio: asset:${key} topilmadi`);
    if (asset.status !== undefined && asset.status !== "ok") {
      return fail("ASSET_MISSING", `/audio: asset:${key} holati ${asset.status}`);
    }
    if (!assets.data.includes(key)) assets.data.push(key);
  }

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

  // Manba audio (intervyu va h.k.) videoda qoladi: tozalanmagan bo'lsa media layer ovozi yoqiladi.
  const source = audioSpec?.source_audio;
  const keepSourceAudio =
    source !== undefined && source.use_in_video && ctx.audio?.source?.isolatedFile === undefined
      ? refKey(source.asset)
      : null;

  for (const [i, scene] of spec.scenes.entries()) {
    const time = timing[i]!;
    const expansion = expansions[i] ?? null;
    const comp = list.add(
      "comp.create",
      time.comp,
      {
        name: `${String(i + 1).padStart(2, "0")}_${scene.id}`,
        w: frame.w,
        h: frame.h,
        fps,
        dur: time.duration,
        bg: scene.bg ?? expansion?.bg ?? "#000000",
        folder: SCENES_FOLDER,
      },
      scene.id,
    );
    const withSourceAudio = (layer: Layer): Layer =>
      layer.type === "media" && keepSourceAudio !== null && refKey(layer.src) === keepSourceAudio
        ? { ...layer, keep_audio: true }
        : layer;
    if (expansion?.instantiate !== undefined) {
      list.add(
        "template.instantiate",
        `${scene.id}.tpl`,
        { ...expansion.instantiate, comp, start: 0, dur: time.duration },
        scene.id,
      );
    }
    // Shablon layerlari pastda, sahnaning o'z layerlari ustida.
    for (const [j, layer] of (expansion?.layers ?? []).entries()) {
      compileLayer(
        list,
        withSourceAudio(layer),
        `${scene.id}.tpl.${layer.id ?? `l${j}`}`,
        comp,
        time,
        scene.id,
        frame,
        ctx,
        warnings,
      );
    }
    for (const [j, layer] of (scene.layers ?? []).entries()) {
      compileLayer(
        list,
        withSourceAudio(layer),
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

  const audioWarnings = compileAudio(
    list,
    spec,
    ctx,
    timing,
    planned.data.voOffset,
    frame,
    duration,
  );
  warnings.push(...audioWarnings);

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
  // Barqaror id'li layer AE'da shu nom bilan (aep shablon slotlari va qo'lda tahrir uchun).
  const named = layer.id === undefined ? {} : { name: layer.id };

  switch (layer.type) {
    case "media": {
      const asset = ctx.assets[refKey(layer.src)]!;
      const pos = toPixels(layer.pos, frame);
      const params: OpParamsMap["layer.add_media"] = {
        comp,
        item: `asset.${asset.key}`,
        ...timingParams,
        ...named,
        fit: layer.fit,
        pos,
      };
      if (layer.opacity !== 100) params.opacity = layer.opacity;
      if (layer.keep_audio) params.keep_audio = true;
      if (layer.scale !== 1) params.scale = layer.scale;
      list.add("layer.add_media", opId, params, sceneId);
      const clip = asset.meta.duration ?? null;
      if (asset.kind === "video" && clip !== null && clip + 1e-6 < dur) {
        warnings.push(`${opId}: video (${clip} s) layer'dan (${dur} s) qisqa`);
      }
      list.motion(
        animOps(
          layer.anim,
          {
            layer: opId,
            kind: "media",
            pos,
            scale: fitScale(layer.fit, asset.meta, frame).map((v) => round(v * layer.scale)) as [
              number,
              number,
            ],
            dur,
          },
          frame,
        ),
        opId,
        sceneId,
      );
      return;
    }
    case "text": {
      const pos = toPixels(layer.pos, frame);
      const style = textStyle(layer.style, frame);
      const box = textBox(layer.text, style, layer.max_width, frame);
      list.add(
        "layer.add_text",
        opId,
        {
          comp,
          text: layer.text,
          ...timingParams,
          ...named,
          style,
          pos,
          ...(box === null ? {} : { box }),
        },
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
        ...named,
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

/** Manba asset'ining asosiy timeline'dagi boshlanishi (u qo'yilgan birinchi sahna layer'i). */
function sourceOffset(spec: VideoSpec, assetRef: string, timing: CompiledScene[]): number {
  for (const [i, scene] of spec.scenes.entries()) {
    const layer = (scene.layers ?? []).find(
      (l) => (l.type === "media" || l.type === "audio") && l.src === assetRef,
    );
    if (layer !== undefined) return round(timing[i]!.start + (layer.start ?? 0));
  }
  return 0;
}

/**
 * Asosiy comp'dagi audio (P4.11): voiceover, tozalangan manba ovoz, musiqa (+ ducking), SFX (langarlar bilan),
 * subtitrlar (`captions.build`). Hammasi barqaror op_id'lar bilan: `aes.vo`, `aes.music`, `aes.sfx.<id>` …
 */
function compileAudio(
  list: OpList,
  spec: VideoSpec,
  ctx: CompileContext,
  timing: CompiledScene[],
  voOffset: number,
  frame: Frame,
  duration: number,
): string[] {
  const warnings: string[] = [];
  const audio = spec.audio;
  if (audio === undefined) return warnings;
  const files = ctx.audio ?? {};
  const AUDIO_FOLDER = "Audio";
  const importFile = (opId: string, file: string) =>
    list.add("item.import", opId, { file, folder: AUDIO_FOLDER });

  let voiceLayer: string | null = null;
  let voiceWords: CaptionWord[] = [];
  // Voiceover: TTS/dialog fayli yoki tayyor asset.
  const voSpec = audio.voiceover;
  if (voSpec !== undefined) {
    const item =
      voSpec.kind === "asset"
        ? `asset.${refKey(voSpec.asset)}`
        : files.voiceover !== undefined
          ? importFile("audio.vo", files.voiceover.file)
          : null;
    if (item === null) {
      warnings.push("Voiceover fayli yo'q (AUDIO bajarilmagan) — ovozsiz quriladi");
    } else {
      voiceLayer = list.add("layer.add_audio", "aes.vo", {
        comp: MAIN_COMP,
        item,
        start: voOffset,
        volume: 0,
        name: "VOICEOVER",
      });
      voiceWords = shiftWords(files.voiceover?.words ?? [], voOffset);
    }
  }

  // Manba audio: tozalangan versiya asosiy comp'ga.
  const source = audio.source_audio;
  let sourceWords: CaptionWord[] = [];
  if (source !== undefined) {
    const offset = sourceOffset(spec, source.asset, timing);
    sourceWords = shiftWords(files.source?.words ?? [], offset);
    if (files.source?.isolatedFile !== undefined && source.use_in_video) {
      const item = importFile("audio.source", files.source.isolatedFile);
      const layer = list.add("layer.add_audio", "aes.source", {
        comp: MAIN_COMP,
        item,
        start: offset,
        volume: 0,
        name: "SOURCE (clean)",
      });
      if (voiceLayer === null) voiceLayer = layer;
    }
    if (voiceWords.length === 0) voiceWords = sourceWords;
  }

  // Musiqa (+ ducking).
  const music = audio.music;
  if (music !== undefined) {
    const item =
      music.kind === "asset"
        ? `asset.${refKey(music.asset)}`
        : files.music !== undefined
          ? importFile("audio.music", files.music.file)
          : null;
    if (item === null) warnings.push("Musiqa fayli yo'q (AUDIO bajarilmagan)");
    else {
      const layer = list.add("layer.add_audio", "aes.music", {
        comp: MAIN_COMP,
        item,
        start: 0,
        dur: duration,
        volume: music.volume_db,
        name: "MUSIC",
      });
      if (music.duck_under === "voiceover" && voiceLayer !== null && voiceWords.length > 0) {
        list.add("audio.duck", "aes.duck", {
          music_layer: layer,
          voice_layer: voiceLayer,
          amount_db: music.duck_db,
          segments: voiceSegments(voiceWords),
          fade: 0.25,
        });
      }
    }
  }

  // SFX: langar (`s1.end`) yoki soniya.
  for (const sfx of audio.sfx) {
    const at = resolveAt(sfx.at, timing);
    if (at === null) {
      warnings.push(`SFX ${sfx.id}: langar topilmadi (${String(sfx.at)})`);
      continue;
    }
    const item =
      sfx.asset !== undefined
        ? `asset.${refKey(sfx.asset)}`
        : files.sfx?.[sfx.id] !== undefined
          ? importFile(`audio.sfx.${sfx.id}`, files.sfx[sfx.id]!.file)
          : null;
    if (item === null) {
      warnings.push(`SFX ${sfx.id} fayli yo'q`);
      continue;
    }
    list.add("layer.add_audio", `aes.sfx.${sfx.id}`, {
      comp: MAIN_COMP,
      item,
      start: Math.min(at, Math.max(0, duration - 0.05)),
      volume: sfx.volume_db,
      name: `SFX ${sfx.id}`,
    });
  }

  // Subtitrlar.
  const captions = audio.captions;
  if (captions !== undefined) {
    const words = captions.from === "voiceover" ? voiceWords : sourceWords;
    if (words.length === 0) warnings.push("Subtitr uchun so'z vaqtlari yo'q");
    else {
      list.add("captions.build", "aes.captions", {
        comp: MAIN_COMP,
        words: words.filter((w) => w.start < duration),
        style: captions.style,
        pos: toPixels(captions.pos, frame),
        max_words: captions.max_words,
        box_w: Math.round(frame.w * 0.86),
      });
    }
  }
  return warnings;
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
