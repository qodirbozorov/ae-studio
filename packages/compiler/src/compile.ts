/**
 * Video Spec → oplist (§9 → §10.1). Sof va deterministik funksiya: bir xil Spec va kontekst → bir xil oplar.
 *
 * Tuzilma: loyiha → importlar → asosiy comp → har sahna: comp + layerlar (+ animatsiya) → nest
 * (+ o'tish) → saqlash. op_id'lar Spec'dagi barqaror nomlardan (sahna id, layer id/indeks) yasaladi:
 * resume'da AE'dagi iz bo'yicha bajarilganlar qayta yaratilmaydi, patch'da faqat o'zgargan qism yangilanadi.
 */
import { ICON_BASE_PT, fail, iconFile, iconName, makeOp, ok } from "@aes/shared";
import type {
  AeOpName,
  Aspect,
  Brand,
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
import { buildLook } from "./brand";
import type { Look } from "./brand";
import { aspectOf, brandTokens, expandTemplate } from "./template";
import type { CompileTemplate, ExpandedTemplate, TokenValue } from "./template";
import { planTiming, resolveAt, shiftWords, voiceSegments } from "./timing";
import { compileContents, emitPro, hasPixelFields, scalePro } from "./pro";
import { scriptParams } from "./scripts";
import type { AddOp } from "./pro";
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
  /** Recipe shablonlari uchun qo'shimcha tokenlar (berilmasa `brand` dan). */
  tokens?: Record<string, TokenValue>;
  /** Brand kit (§11.3): matn shrifti/rangi, sahna foni, subtitr stili, shablon tokenlari. */
  brand?: Brand;
  /** AE'dagi shriftlar (PostScript nomlari; `info` op). null — noma'lum (AE < 24): tekshirilmaydi. */
  fonts?: string[] | null;
}

type LayerContext = CompileContext & { look: Look };

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

/** Format varianti (§11.4.1): alohida asosiy comp, alohida render. */
export interface CompiledVariant {
  aspect: Aspect;
  /** op_id prefiksi va fayl nomi qo'shimchasi: `16x9`. */
  tag: string;
  mainComp: string;
  /** AE'dagi comp nomi va render fayli asosi: `<output.name>_<tag>`. */
  name: string;
  w: number;
  h: number;
}

export interface CompileOutput {
  ops: OpEnvelope[];
  scenes: CompiledScene[];
  duration: number;
  /** Asosiy comp'ning op_id si (VERIFY va RENDER shunga murojaat qiladi). */
  mainComp: string;
  /** Qo'shimcha formatlar (asosiy formatdan tashqari). */
  variants: CompiledVariant[];
  /** VERIFY uchun kadr vaqtlari (§3). */
  keyTimes: number[];
  warnings: string[];
}

export const MAIN_COMP = "aes.main";
const SOURCE_FOLDER = "Source";
const SCENES_FOLDER = "Scenes";

class OpList {
  readonly ops: OpEnvelope[] = [];
  private readonly ids = new Set<string>();
  /** Takrorlangan op_id'lar (masalan layer id "bg" sahna fon qatlami bilan to'qnashsa) — DB unique buziladi. */
  readonly dups: string[] = [];
  has(opId: string): boolean {
    return this.ids.has(opId);
  }
  add<N extends AeOpName>(op: N, opId: string, params: OpParamsMap[N], sceneId?: string): string {
    if (this.ids.has(opId)) this.dups.push(opId);
    const extra = sceneId === undefined ? {} : { scene_id: sceneId };
    this.ops.push(makeOp(op, opId, this.ops.length, params, extra) as OpEnvelope);
    this.ids.add(opId);
    return opId;
  }
  motion(ops: MotionOp[], prefix: string, sceneId?: string): void {
    for (const m of ops) this.add(m.op, `${prefix}.${m.suffix}`, m.params as never, sceneId);
  }
}

function textStyle(style: TextStyle, frame: Frame, look: Look): TextStyleOp {
  const op: TextStyleOp = {
    size: style.size ?? Math.round(frame.h * 0.045),
    color: style.color ?? look.color,
    justify: style.align ?? "center",
  };
  const font = look.font(style.font);
  if (font !== undefined) op.font = font;
  if (style.stroke_color !== undefined) op.stroke_color = style.stroke_color;
  if (style.stroke_width !== undefined) op.stroke_width = style.stroke_width;
  if (style.all_caps !== undefined) op.all_caps = style.all_caps;
  return op;
}

/**
 * Matn `max_width` ga sig'masa paragraf qutisi (AE `addBoxText`, markazi `pos` da): eni `max_width`, balandligi
 * taxminiy qatorlar soni bo'yicha. Kenglik taxmini: belgi ≈ 0.55 × o'lcham (katta harf 0.65). Sig'sa — nuqtali matn.
 */
/** Nuqtali matnning taxminiy eni (belgi ≈ 0.55 × o'lcham, katta harf 0.65). */
export function textWidth(text: string, style: TextStyleOp, frame: Frame): number {
  const size = style.size ?? Math.round(frame.h * 0.045);
  const upper = style.all_caps === true || text === text.toUpperCase();
  return text.length * size * (upper ? 0.65 : 0.55);
}

export function textBox(
  text: string,
  style: TextStyleOp,
  maxWidth: number,
  frame: Frame,
): [number, number] | null {
  const size = style.size ?? Math.round(frame.h * 0.045);
  const estimate = textWidth(text, style, frame);
  const width = Math.round(maxWidth * frame.w);
  if (estimate <= width) return null;
  const lines = Math.ceil(estimate / width) + (text.includes("\n") ? 1 : 0);
  return [width, Math.round(lines * size * 1.3 + size * 0.4)];
}

/** Variant kadri: qisqa tomon asosiy formatniki, uzun tomon aspekt bo'yicha (juft son). */
export function variantFrames(spec: VideoSpec): { aspect: Aspect; tag: string; frame: Frame }[] {
  const base = { w: spec.format.w, h: spec.format.h };
  const short = Math.min(base.w, base.h);
  const long = Math.round((short * 16) / 9 / 2) * 2;
  const out: { aspect: Aspect; tag: string; frame: Frame }[] = [];
  for (const aspect of spec.variants) {
    if (aspect === aspectOf(base)) continue;
    const frame =
      aspect === "9:16"
        ? { w: short, h: long }
        : aspect === "16:9"
          ? { w: long, h: short }
          : { w: short, h: short };
    out.push({ aspect, tag: aspect.replace(":", "x"), frame });
  }
  return out;
}

/** Variant uchun piksel qiymatlari (shrift o'lchami, chiziq, radius) qisqa tomonlar nisbatida. */
function scaleLayer(layer: Layer, k: number, rx = 1, ry = 1): Layer {
  if (Math.abs(k - 1) < 1e-9 && Math.abs(rx - 1) < 1e-9 && Math.abs(ry - 1) < 1e-9) return layer;
  if (layer.type === "audio") return layer;
  const pro = scalePro(layer, k, rx, ry);
  if (pro.type === "text") {
    const style = { ...pro.style };
    if (style.size !== undefined) style.size = round(style.size * k);
    if (style.stroke_width !== undefined) style.stroke_width = round(style.stroke_width * k);
    return { ...pro, style };
  }
  if (pro.type === "shape") return { ...pro, radius: round(pro.radius * k) };
  if (pro.type === "icon") return { ...pro, size: round(pro.size * k) };
  return pro;
}

/** Safe area (har tomondan 4%): matn markazi qutisi kadrdan chiqmaydigan qilib suriladi. */
function safePos(pos: [number, number], width: number, frame: Frame): [number, number] {
  const margin = 0.04;
  const half = width / 2;
  const minX = frame.w * margin + half;
  const maxX = frame.w * (1 - margin) - half;
  const x = minX <= maxX ? Math.min(Math.max(pos[0], minX), maxX) : frame.w / 2;
  const y = Math.min(Math.max(pos[1], frame.h * margin), frame.h * (1 - margin));
  return [round(x), round(y)];
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

  // Shablon tokenlari: brand kit (logo asset loyihada bo'lmasa — logo'siz, ogohlantirish bilan).
  const tokens = { ...(ctx.tokens ?? brandTokens(ctx.brand)) };
  const logo = tokens["brand.logo"];
  if (typeof logo === "string" && ctx.assets[refKey(logo)] === undefined) {
    delete tokens["brand.logo"];
    warnings.push(`Brand logo (${logo}) loyihada yo'q — logo'siz`);
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
      tokens,
    );
    if (!expanded.ok) return expanded;
    warnings.push(...expanded.data.warnings);
    expansions.push(expanded.data);
  }

  const assets = checkAssets(spec, ctx, expansions);
  if (!assets.ok) return assets;
  // Shriftlar: brand default'i va fallback; AE'da yo'q bo'lsa AE_FONT_MISSING (PREFLIGHT).
  const allLayers = spec.scenes.flatMap((scene, i) => [
    ...(expansions[i]?.layers ?? []),
    ...(scene.layers ?? []),
  ]);
  const look = buildLook(allLayers, ctx.brand, ctx.fonts, warnings);
  if (!look.ok) return look;
  const lctx: LayerContext = { ...ctx, look: look.data };
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

  // Gibrid skriptlar: hook bo'yicha asosiy formatda (after_layer / after_scene / after_build).
  const scripts = spec.scripts ?? [];
  const sceneIds = new Set(spec.scenes.map((scene) => scene.id));
  const layerIds = new Set(spec.scenes.flatMap((scene) => (scene.layers ?? []).map((l) => l.id)));
  for (const script of scripts) {
    if ((script.lib === undefined) === (script.code === undefined)) {
      return fail("SPEC_INVALID", `/scripts/${script.id}: lib yoki code (bittasi)`);
    }
    const [kind, target] = script.hook.split(":");
    if (kind === "after_scene" && !sceneIds.has(target!)) {
      return fail("SPEC_INVALID", `/scripts/${script.id}: sahna yo'q: ${target}`);
    }
    if (kind === "after_layer" && !layerIds.has(target)) {
      return fail("SPEC_INVALID", `/scripts/${script.id}: layer yo'q: ${target}`);
    }
  }
  const emitted = new Set<string>();
  const hookScripts = (
    hook: string,
    sceneId: string | undefined,
    extra: Record<string, unknown>,
    refs?: Map<string, string>,
  ): Result<void> => {
    for (const script of scripts) {
      if (script.hook !== hook || emitted.has(script.id)) continue;
      emitted.add(script.id);
      const more = { ...extra };
      const named = script.args?.layer;
      if (more.__ref === undefined && typeof named === "string" && refs?.has(named)) {
        more.__ref = refs.get(named);
      }
      const params = scriptParams(script, more);
      if (!params.ok)
        return {
          ...params,
          error: {
            ...params.error,
            message: `/scripts/${script.id}: ${params.error.message ?? ""}`,
          },
        };
      list.add("jsx.run", `script.${script.id}`, params.data, sceneId);
    }
    return ok(undefined);
  };
  list.add("project.open_or_create", "aes.project", { path: ctx.projectPath });
  for (const key of assets.data) {
    list.add("item.import", `asset.${key}`, {
      file: ctx.assets[key]!.local_path,
      folder: SOURCE_FOLDER,
    });
  }
  // Manba audio (intervyu va h.k.) videoda qoladi: tozalanmagan bo'lsa media layer ovozi yoqiladi.
  const source = audioSpec?.source_audio;
  const keepSourceAudio =
    source !== undefined && source.use_in_video && ctx.audio?.source?.isolatedFile === undefined
      ? refKey(source.asset)
      : null;
  const withSourceAudio = (layer: Layer): Layer =>
    layer.type === "media" && keepSourceAudio !== null && refKey(layer.src) === keepSourceAudio
      ? { ...layer, keep_audio: true }
      : layer;

  // Asosiy format + variantlar (§11.4.1): har biri o'z asosiy comp'i va sahna comp'lari bilan.
  const variants = variantFrames(spec);
  const trees = [
    { tag: null as string | null, frame, main: MAIN_COMP, name: spec.output.name, prefix: "" },
    ...variants.map((v) => ({
      tag: v.tag as string | null,
      frame: v.frame,
      main: `${MAIN_COMP}.${v.tag}`,
      name: `${spec.output.name}_${v.tag}`,
      prefix: `${v.tag}.`,
    })),
  ];
  for (const tree of trees) {
    const k = Math.min(tree.frame.w, tree.frame.h) / Math.min(frame.w, frame.h);
    list.add("comp.create", tree.main, {
      name: tree.name,
      w: tree.frame.w,
      h: tree.frame.h,
      fps,
      dur: duration,
      bg: "#000000",
    });
    for (const [i, scene] of spec.scenes.entries()) {
      const time = timing[i]!;
      const expansion = expansions[i] ?? null;
      if (tree.tag !== null && scene.template !== undefined) {
        const manifest = ctx.templates?.[scene.template]?.manifest;
        const aspect = aspectOf(tree.frame);
        if (manifest !== undefined && !manifest.formats.includes(aspect)) {
          warnings.push(
            `${scene.id}: '${scene.template}' shabloni ${aspect} formatga mo'ljallanmagan`,
          );
        }
      }
      const bg = scene.bg ?? expansion?.bg ?? ctx.brand?.colors.background;
      const comp = list.add(
        "comp.create",
        `${tree.prefix}${time.comp}`,
        {
          name: `${tree.tag === null ? "" : `${tree.tag}_`}${String(i + 1).padStart(2, "0")}_${scene.id}`,
          w: tree.frame.w,
          h: tree.frame.h,
          fps,
          dur: time.duration,
          bg: bg ?? "#000000",
          folder: tree.tag === null ? SCENES_FOLDER : `${SCENES_FOLDER} ${tree.tag}`,
        },
        scene.id,
      );
      // #4: nested comp'ning bgColor'i asosiy comp'da render qilinmaydi (precomp foni shaffof) —
      // fon aniq berilsa eng pastda to'liq kadrli rang qatlami.
      if (bg !== undefined) {
        list.add(
          "layer.add_shape",
          `${tree.prefix}${scene.id}.bg`,
          {
            comp,
            kind: "rect",
            color: bg,
            size: [tree.frame.w, tree.frame.h],
            pos: [round(tree.frame.w / 2), round(tree.frame.h / 2)],
            start: 0,
            name: "BG",
          },
          scene.id,
        );
      }
      if (expansion?.instantiate !== undefined) {
        list.add(
          "template.instantiate",
          `${tree.prefix}${scene.id}.tpl`,
          { ...expansion.instantiate, comp, start: 0, dur: time.duration },
          scene.id,
        );
      }
      // Shablon layerlari pastda, sahnaning o'z layerlari ustida.
      const layers: [Layer, string][] = [
        ...(expansion?.layers ?? []).map((layer, j): [Layer, string] => [
          layer,
          `${scene.id}.tpl.${layer.id ?? `l${j}`}`,
        ]),
        ...(scene.layers ?? []).map((layer, j): [Layer, string] => [
          layer,
          `${scene.id}.${layer.id ?? `l${j}`}`,
        ]),
      ];
      // Faza 7: parent/matte havolalari (layer id → op ref) sahnaning hamma layerlari yaratilgach.
      const refs = new Map<string, string>();
      for (const [layer, opId] of layers) {
        if (layer.id !== undefined) refs.set(layer.id, `${tree.prefix}${opId}`);
      }
      const links: (() => void)[] = [];
      const rx = tree.frame.w / frame.w;
      const ry = tree.frame.h / frame.h;
      for (const [layer, opId] of layers) {
        if (tree.tag !== null && layer.type !== "audio" && hasPixelFields(layer)) {
          warnings.push(
            `${opId}: ${tree.tag} variantida effekt/maska piksel qiymatlari masshtablanmadi`,
          );
        }
        const compiled = compileLayer(
          list,
          scaleLayer(withSourceAudio(layer), k, rx, ry),
          `${tree.prefix}${opId}`,
          comp,
          time,
          scene.id,
          tree.frame,
          lctx,
          warnings,
          { refOf: (id) => refs.get(id) ?? `${tree.prefix}${scene.id}.${id}`, links },
        );
        if (!compiled.ok) return compiled;
        if (tree.tag === null && layer.id !== undefined) {
          const hooked = hookScripts(`after_layer:${layer.id}`, scene.id, {
            __comp: `${String(i + 1).padStart(2, "0")}_${scene.id}`,
            __ref: `${tree.prefix}${opId}`,
          });
          if (!hooked.ok) return hooked;
        }
      }
      for (const link of links) link();
      if (tree.tag === null) {
        const hooked = hookScripts(
          `after_scene:${scene.id}`,
          scene.id,
          { __comp: `${String(i + 1).padStart(2, "0")}_${scene.id}` },
          refs,
        );
        if (!hooked.ok) return hooked;
      }
      const nest = list.add(
        "comp.nest",
        `${tree.prefix}${scene.id}.nest`,
        { child: comp, parent: tree.main, start: time.start, dur: time.duration, name: scene.id },
        scene.id,
      );
      list.motion(
        transitionOps(scene.transition_out, nest, time.start + time.duration, tree.frame),
        nest,
        scene.id,
      );
      // Oraliq saqlash: resume'da bajarilgan sahnalar diskda bo'ladi.
      list.add("project.save", `${tree.prefix}${scene.id}.save`, save, scene.id);
    }

    const audioWarnings = compileAudio(
      list,
      spec,
      ctx,
      timing,
      planned.data.voOffset,
      tree.frame,
      duration,
      { main: tree.main, prefix: tree.prefix },
    );
    if (tree.tag === null) warnings.push(...audioWarnings);
  }

  const finalScripts = hookScripts("after_build", undefined, {});
  if (!finalScripts.ok) return finalScripts;
  list.add("project.save", "aes.save", save);
  if (list.dups.length > 0) {
    return fail(
      "SPEC_INVALID",
      `id to'qnashuvi: ${[...new Set(list.dups)].join(", ")} — layer/script id'ni o'zgartiring ("bg", "tpl" band: sahna foni va shablon)`,
    );
  }

  return ok({
    ops: list.ops,
    scenes: timing,
    duration,
    mainComp: MAIN_COMP,
    variants: variants.map((v) => ({
      aspect: v.aspect,
      tag: v.tag,
      mainComp: `${MAIN_COMP}.${v.tag}`,
      name: `${spec.output.name}_${v.tag}`,
      w: v.frame.w,
      h: v.frame.h,
    })),
    keyTimes: keyTimes(timing, duration),
    warnings: [...new Set(warnings)],
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
  ctx: LayerContext,
  warnings: string[],
  pro: { refOf: (id: string) => string; links: (() => void)[] },
): Result<void> {
  const add: AddOp = (op, id, params) => list.add(op, id, params, sceneId);
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
      return emitPro(add, layer, opId, pro.refOf, pro.links);
    }
    case "text": {
      const style = textStyle(layer.style, frame, ctx.look);
      const box = textBox(layer.text, style, layer.max_width, frame);
      const pos = safePos(
        toPixels(layer.pos, frame),
        box?.[0] ?? textWidth(layer.text, style, frame),
        frame,
      );
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
      return emitPro(add, layer, opId, pro.refOf, pro.links);
    }
    case "shape": {
      const pos = toPixels(layer.pos, frame);
      const params: OpParamsMap["layer.add_shape"] = { comp, pos, ...timingParams, ...named };
      let extraKeys: Parameters<typeof emitPro>[5] = [];
      if (layer.contents !== undefined) {
        const compiled = compileContents(layer.contents, opId);
        if (!compiled.ok) return compiled;
        params.contents = compiled.data.contents;
        if (compiled.data.gradient !== null) params.gradient_colors = compiled.data.gradient;
        extraKeys = compiled.data.keyframes;
      } else {
        params.kind = layer.kind!;
        params.color = layer.color!;
        params.size = [round(layer.size!.w * frame.w), round(layer.size!.h * frame.h)];
        if (layer.radius > 0) params.radius = layer.radius;
      }
      if (layer.opacity !== 100) params.opacity = layer.opacity;
      list.add("layer.add_shape", opId, params, sceneId);
      list.motion(
        animOps(layer.anim, { layer: opId, kind: "shape", pos, scale: [100, 100], dur }, frame),
        opId,
        sceneId,
      );
      return emitPro(add, layer, opId, pro.refOf, pro.links, extraKeys);
    }
    case "icon": {
      // Lucide → PDF (server PREFLIGHT'da `icons/` ga yetkazadi) → vektor footage.
      const item = `icon.${iconName(layer.name)}.${layer.color.replace("#", "").toLowerCase()}.${Math.round(layer.stroke_width * 100)}`;
      if (!list.has(item)) {
        list.add("item.import", item, {
          file: iconFile(layer.name, layer.color, layer.stroke_width),
          folder: "Icons",
        });
      }
      const pos = toPixels(layer.pos, frame);
      const scale = round(layer.size / ICON_BASE_PT);
      const params: OpParamsMap["layer.add_media"] = {
        comp,
        item,
        fit: "none",
        scale,
        pos,
        vector: true,
        ...timingParams,
        ...named,
      };
      if (layer.as_shapes) params.as_shapes = true;
      if (layer.opacity !== 100) params.opacity = layer.opacity;
      list.add("layer.add_media", opId, params, sceneId);
      list.motion(
        animOps(
          layer.anim,
          { layer: opId, kind: "media", pos, scale: [scale * 100, scale * 100], dur },
          frame,
        ),
        opId,
        sceneId,
      );
      return emitPro(add, layer, opId, pro.refOf, pro.links);
    }
    case "solid":
    case "null":
    case "adjustment": {
      const pos =
        layer.type === "adjustment"
          ? ([round(frame.w / 2), round(frame.h / 2)] as [number, number])
          : toPixels(layer.pos, frame);
      const params: OpParamsMap["layer.add_solid"] = {
        comp,
        kind: layer.type,
        pos,
        ...timingParams,
        ...named,
      };
      if (layer.type === "solid") {
        params.color = layer.color;
        if (layer.size !== undefined) params.size = layer.size;
        if (layer.opacity !== 100) params.opacity = layer.opacity;
      }
      list.add("layer.add_solid", opId, params, sceneId);
      if (layer.type === "solid") {
        list.motion(
          animOps(layer.anim, { layer: opId, kind: "shape", pos, scale: [100, 100], dur }, frame),
          opId,
          sceneId,
        );
      }
      return emitPro(add, layer, opId, pro.refOf, pro.links);
    }
    case "audio": {
      list.add(
        "layer.add_audio",
        opId,
        { comp, item: `asset.${refKey(layer.src)}`, ...timingParams, volume: layer.volume_db },
        sceneId,
      );
      return ok(undefined);
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
  target: { main: string; prefix: string },
): string[] {
  const warnings: string[] = [];
  const audio = spec.audio;
  if (audio === undefined) return warnings;
  const files = ctx.audio ?? {};
  const AUDIO_FOLDER = "Audio";
  // Fayl importi variantlar uchun bitta (op_id takrorlanmaydi).
  const importFile = (opId: string, file: string) =>
    list.has(opId) ? opId : list.add("item.import", opId, { file, folder: AUDIO_FOLDER });

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
      voiceLayer = list.add("layer.add_audio", `${target.prefix}aes.vo`, {
        comp: target.main,
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
      const layer = list.add("layer.add_audio", `${target.prefix}aes.source`, {
        comp: target.main,
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
      const layer = list.add("layer.add_audio", `${target.prefix}aes.music`, {
        comp: target.main,
        item,
        start: 0,
        dur: duration,
        volume: music.volume_db,
        name: "MUSIC",
      });
      if (music.duck_under === "voiceover" && voiceLayer !== null && voiceWords.length > 0) {
        list.add("audio.duck", `${target.prefix}aes.duck`, {
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
    list.add("layer.add_audio", `${target.prefix}aes.sfx.${sfx.id}`, {
      comp: target.main,
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
      list.add("captions.build", `${target.prefix}aes.captions`, {
        comp: target.main,
        words: words.filter((w) => w.start < duration),
        style: captions.style ?? ctx.brand?.captions.style ?? "karaoke_bold",
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
