/**
 * Oplar uchun zod sxemalari (ae-studio-plan.md §10.1). Tiplar `ae.ts` da; bu yerdagi har sxema
 * o'sha tipga compile vaqtida tenglashtiriladi (`MutualCheck`), shuning uchun ular ajralib keta olmaydi.
 */
import { z } from "zod";
import type * as Ae from "./ae";
import { hexColorSchema, parseWith, slugSchema } from "./common";
import type { Result } from "./result";

/** Spec'dan kompilyatsiya qilinadigan yopiq op to'plami (§10.1, 18 ta). */
export const OP_NAMES = [
  "project.open_or_create",
  "project.save",
  "item.import",
  "comp.create",
  "comp.nest",
  "layer.add_media",
  "layer.add_text",
  "layer.add_shape",
  "layer.add_audio",
  "prop.keyframes",
  "prop.expression",
  "fx.apply_preset",
  "fx.add",
  "captions.build",
  "audio.duck",
  "template.instantiate",
  "frames.capture",
  "render.queue",
  // Faza 7: professional qatlamlar.
  "layer.add_solid",
  "layer.set",
  "layer.mask",
] as const;

/** Tizim oplari: diagnostika uchun, Spec'dan chiqmaydi. */
export const SYSTEM_OP_NAMES = [
  "ping",
  "info",
  "undo",
  "fx.catalog",
  "fx.params",
  "layer.inspect",
] as const;

export type OpName = (typeof OP_NAMES)[number];

export const PROP_ALIASES = ["position", "scale", "rotation", "opacity", "anchor_point"] as const;

/** `prop.expression` kutubxonasi (§11.4.4). ExtendScript tomonidagi `lib/expressions.ts` bilan bir xil. */
export const EXPRESSION_IDS = ["wiggle", "loop_out", "bounce", "pulse", "typewriter"] as const;

/** Op timeout'lari (ms), §2.3 "har chaqiruvda timeout". */
export const DEFAULT_OP_TIMEOUT_MS = 30_000;
export const OP_TIMEOUT_MS: { [N in Ae.AeOpName]?: number } = {
  "project.open_or_create": 120_000,
  "project.save": 120_000,
  "item.import": 120_000,
  "captions.build": 120_000,
  "template.instantiate": 120_000,
  "frames.capture": 180_000,
  "render.queue": 3_600_000,
};

export function opTimeoutMs(op: Ae.AeOpName): number {
  return OP_TIMEOUT_MS[op] ?? DEFAULT_OP_TIMEOUT_MS;
}

/** Fayl yo'li bo'lgan parametrlar: panel ham, server ham ularni ish papkasi ichida ekanini tekshiradi (§4.4). */
export const OP_PATH_PARAMS: { [N in Ae.AeOpName]?: readonly string[] } = {
  "project.open_or_create": ["path"],
  "project.save": ["path"],
  "item.import": ["file"],
  "fx.apply_preset": ["ffx"],
  "template.instantiate": ["file"],
  "frames.capture": ["dir"],
  "render.queue": ["out"],
};

// ---------------------------------------------------------------- primitivlar

/** AE comment'iga `[aes:<op_id>]` ko'rinishida yoziladi, shuning uchun `]` va bo'sh joy yo'q. */
export const OP_ID_RE = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
export const opIdSchema = z.string().regex(OP_ID_RE, {
  error: "op_id: kichik harf, raqam, '_', '.', ':', '-' (1–128 belgi)",
});
const refSchema = opIdSchema;
const timeSchema = z.number().min(0).max(36_000);
const durSchema = z.number().positive().max(36_000);
const vec2Schema = z.tuple([z.number(), z.number()]);
const sizeSchema = z.tuple([z.number().positive(), z.number().positive()]);
const nameSchema = z.string().min(1).max(255);
/** Nisbiy yo'l; to'liq tekshiruv `paths.ts` dagi `resolveInsideRoot` da (OS'ga bog'liq). */
const relPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !/^([a-zA-Z]:|[\\/])/.test(value), {
    error: "Yo'l nisbiy bo'lishi kerak (ish papkasiga nisbatan)",
  })
  .refine((value) => !value.split(/[\\/]/).includes(".."), {
    error: "Yo'lda '..' bo'lishi mumkin emas",
  });
const scalarSchema = z.union([z.string().max(2000), z.number(), z.boolean()]);
const propPathSchema = z.union([
  z.enum(PROP_ALIASES),
  z.string().regex(/^[^/]{1,128}(\/[^/]{1,128}){0,7}$/, {
    error: "prop: alias yoki 'ADBE Transform Group/ADBE Position' ko'rinishidagi matchName yo'li",
  }),
]);

// ---------------------------------------------------------------- Faza 7: professional qatlamlar

const pctSchema = z.number().min(0).max(100);
const bigNum = z.number().min(-1_000_000).max(1_000_000);

const shapePathOp = z.strictObject({
  points: z.array(vec2Schema).min(1).max(5000),
  in: z.array(vec2Schema).max(5000),
  out: z.array(vec2Schema).max(5000),
  closed: z.boolean(),
});

const shapeGradientOp = z.strictObject({
  type: z.enum(["linear", "radial"]),
  start: vec2Schema,
  end: vec2Schema,
});

const shapeFillOp = z.strictObject({
  color: hexColorSchema.optional(),
  gradient: shapeGradientOp.optional(),
  opacity: pctSchema.optional(),
  rule: z.enum(["nonzero", "evenodd"]).optional(),
});

const lineJoin = z.enum(["miter", "round", "bevel"]);

const shapeStrokeOp = z.strictObject({
  color: hexColorSchema.optional(),
  gradient: shapeGradientOp.optional(),
  opacity: pctSchema.optional(),
  width: z.number().min(0).max(10_000),
  cap: z.enum(["butt", "round", "square"]).optional(),
  join: lineJoin.optional(),
  miter_limit: z.number().min(1).max(100).optional(),
  dashes: z.array(z.number().min(0).max(10_000)).max(6).optional(),
  dash_offset: bigNum.optional(),
});

const shapeRepeaterOp = z.strictObject({
  copies: z.number().min(0).max(1000),
  offset: bigNum.optional(),
  position: vec2Schema.optional(),
  scale: vec2Schema.optional(),
  rotation: bigNum.optional(),
  start_opacity: pctSchema.optional(),
  end_opacity: pctSchema.optional(),
  composite: z.enum(["above", "below"]).optional(),
});

const shapeTransformOp = z.strictObject({
  anchor: vec2Schema.optional(),
  position: vec2Schema.optional(),
  scale: vec2Schema.optional(),
  rotation: bigNum.optional(),
  opacity: pctSchema.optional(),
  skew: bigNum.optional(),
  skew_axis: bigNum.optional(),
});

const shapeContentOp: z.ZodType<Ae.ShapeContentOp> = z.lazy(() =>
  z.strictObject({
    id: z.string().min(1).max(64),
    kind: z.enum(["rect", "ellipse", "star", "polygon", "path", "group"]),
    size: vec2Schema.optional(),
    position: vec2Schema.optional(),
    roundness: z.number().min(0).max(10_000).optional(),
    points: z.number().int().min(3).max(100).optional(),
    outer_radius: z.number().min(0).max(1_000_000).optional(),
    inner_radius: z.number().min(0).max(1_000_000).optional(),
    outer_roundness: bigNum.optional(),
    inner_roundness: bigNum.optional(),
    rotation: bigNum.optional(),
    paths: z.array(shapePathOp).max(200).optional(),
    fill: shapeFillOp.optional(),
    stroke: shapeStrokeOp.optional(),
    trim: z
      .strictObject({
        start: pctSchema.optional(),
        end: pctSchema.optional(),
        offset: bigNum.optional(),
        individually: z.boolean().optional(),
      })
      .optional(),
    round_corners: z.number().min(0).max(10_000).optional(),
    offset_paths: z.strictObject({ amount: bigNum, join: lineJoin.optional() }).optional(),
    merge: z.enum(["merge", "add", "subtract", "intersect", "exclude"]).optional(),
    zig_zag: z
      .strictObject({
        size: bigNum,
        ridges: z.number().min(0).max(100).optional(),
        smooth: z.boolean().optional(),
      })
      .optional(),
    pucker_bloat: z.number().min(-100).max(100).optional(),
    twist: z.strictObject({ angle: bigNum, center: vec2Schema.optional() }).optional(),
    wiggle: z
      .strictObject({
        size: bigNum,
        detail: z.number().min(0).max(100).optional(),
        speed: z.number().min(0).max(100).optional(),
        seed: z.number().int().min(0).max(10_000).optional(),
      })
      .optional(),
    repeater: shapeRepeaterOp.optional(),
    transform: shapeTransformOp.optional(),
    contents: z.array(shapeContentOp).max(100).optional(),
  }),
);

const layerAddSolidParams = z.strictObject({
  comp: refSchema,
  kind: z.enum(["solid", "null", "adjustment"]),
  color: hexColorSchema.optional(),
  size: sizeSchema.optional(),
  pos: vec2Schema,
  start: timeSchema,
  dur: durSchema.optional(),
  name: nameSchema.optional(),
  opacity: pctSchema.optional(),
});

const vecN = z.array(bigNum).min(2).max(3);

const layerSetParams = z.strictObject({
  layer: refSchema,
  three_d: z.boolean().optional(),
  motion_blur: z.boolean().optional(),
  transform: z
    .strictObject({
      anchor: vecN.optional(),
      position: vecN.optional(),
      scale: vecN.optional(),
      rotation: bigNum.optional(),
      opacity: pctSchema.optional(),
      rotation_x: bigNum.optional(),
      rotation_y: bigNum.optional(),
      orientation: z.array(bigNum).length(3).optional(),
    })
    .optional(),
  blend: z
    .string()
    .regex(/^[a-z_]{3,32}$/)
    .optional(),
  parent: refSchema.optional(),
  matte: z
    .strictObject({
      source: refSchema,
      type: z.enum(["alpha", "alpha_inverted", "luma", "luma_inverted"]),
    })
    .optional(),
});

const layerMaskParams = z.strictObject({
  layer: refSchema,
  id: z.string().min(1).max(64),
  path: shapePathOp,
  mode: z.enum(["add", "subtract", "intersect", "lighten", "darken", "difference", "none"]),
  feather: vec2Schema.optional(),
  expansion: bigNum.optional(),
  opacity: pctSchema.optional(),
  inverted: z.boolean().optional(),
});

const fxCatalogParams = z.strictObject({
  query: z.string().max(128).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

const fxParamsParams = z.strictObject({ match_name: z.string().min(1).max(128) });

const layerInspectParams = z.strictObject({
  comp: nameSchema.optional(),
  layer: nameSchema.optional(),
  ref: refSchema.optional(),
  depth: z.number().int().min(0).max(8).optional(),
});

// ---------------------------------------------------------------- op parametrlari

const pingParams = z.strictObject({ echo: z.string().max(200).optional() });

const undoParams = z.strictObject({ op_id: opIdSchema });

const infoParams = z.strictObject({});

const projectOpenOrCreateParams = z.strictObject({
  path: relPathSchema,
  /** Ochiq loyihada saqlanmagan o'zgarish bo'lsa: `autosave` (default) — `_autosave_vNNN` nusxa; `fail`. */
  dirty: z.enum(["autosave", "fail"]).optional(),
});

const projectSaveParams = z.strictObject({
  version: z.number().int().min(1).max(999),
  path: relPathSchema,
});

const itemImportParams = z.strictObject({
  file: relPathSchema,
  folder: nameSchema.optional(),
});

const compCreateParams = z.strictObject({
  name: nameSchema,
  w: z.number().int().min(4).max(30_000),
  h: z.number().int().min(4).max(30_000),
  fps: z.number().positive().max(999),
  dur: durSchema,
  bg: hexColorSchema.optional(),
  folder: nameSchema.optional(),
});

const compNestParams = z.strictObject({
  child: refSchema,
  parent: refSchema,
  start: timeSchema,
  dur: durSchema.optional(),
  name: nameSchema.optional(),
});

const layerAddMediaParams = z.strictObject({
  comp: refSchema,
  item: refSchema,
  start: timeSchema,
  dur: durSchema.optional(),
  fit: z.enum(["cover", "contain", "stretch", "none"]),
  /** `fit` natijasiga ko'paytiruvchi (logo, mahsulot kadrning bir qismini egallaydi). */
  scale: z.number().gt(0).max(4).optional(),
  name: nameSchema.optional(),
  pos: vec2Schema.optional(),
  opacity: z.number().min(0).max(100).optional(),
  keep_audio: z.boolean().optional(),
  vector: z.boolean().optional(),
  as_shapes: z.boolean().optional(),
});

const textStyleOp = z.strictObject({
  font: z.string().min(1).max(128).optional(),
  size: z.number().positive().max(5000).optional(),
  color: hexColorSchema.optional(),
  justify: z.enum(["left", "center", "right"]).optional(),
  tracking: z.number().min(-1000).max(1000).optional(),
  leading: z.number().positive().max(5000).optional(),
  stroke_color: hexColorSchema.optional(),
  stroke_width: z.number().min(0).max(500).optional(),
  all_caps: z.boolean().optional(),
});

const layerAddTextParams = z.strictObject({
  comp: refSchema,
  text: z.string().min(1).max(5000),
  start: timeSchema,
  dur: durSchema.optional(),
  name: nameSchema.optional(),
  style: textStyleOp,
  pos: vec2Schema,
  box: sizeSchema.optional(),
});

const layerAddShapeParams = z.strictObject({
  comp: refSchema,
  kind: z.enum(["rect", "ellipse"]).optional(),
  color: hexColorSchema.optional(),
  size: sizeSchema.optional(),
  contents: z.array(shapeContentOp).max(100).optional(),
  gradient_colors: z.tuple([hexColorSchema, hexColorSchema]).optional(),
  pos: vec2Schema,
  start: timeSchema,
  dur: durSchema.optional(),
  name: nameSchema.optional(),
  radius: z.number().min(0).max(10_000).optional(),
  opacity: z.number().min(0).max(100).optional(),
});

const layerAddAudioParams = z.strictObject({
  comp: refSchema,
  item: refSchema,
  start: timeSchema,
  volume: z.number().min(-96).max(24),
  dur: durSchema.optional(),
  name: nameSchema.optional(),
});

const easePair = z.tuple([z.number().min(-1e6).max(1e6), z.number().min(0.1).max(100)]);

/** Segment ease'i (P6.03, update-technicalguidline §4.3): token, CSS cubic-bezier yoki xom AE qiymatlari. */
export const easeCurveSchema = z.union([
  z.string().regex(/^\$?(enter|exit|move|soft|pop)$|^(linear|hold)$/),
  z.tuple([
    z.number().min(0).max(1),
    z.number().min(-5).max(5),
    z.number().min(0).max(1),
    z.number().min(-5).max(5),
  ]),
  z.strictObject({ in: easePair, out: easePair }),
]);

const keyframeSchema = z.strictObject({
  t: z.number().min(-36_000).max(36_000),
  v: z.union([z.number(), z.array(z.number()).min(1).max(4), z.string().max(5000)]),
  ease: easeCurveSchema.optional(),
});

const propKeyframesParams = z.strictObject({
  layer: refSchema,
  prop: propPathSchema,
  keys: z.array(keyframeSchema).min(1).max(1000),
  ease: z.union([
    z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "hold"]),
    easeCurveSchema,
  ]),
  relative: z.boolean(),
  spatial: z.enum(["linear", "auto"]).optional(),
});

const propExpressionParams = z.strictObject({
  layer: refSchema,
  prop: propPathSchema,
  expr_id: slugSchema,
  args: z.record(z.string().min(1).max(64), scalarSchema).optional(),
});

const fxApplyPresetParams = z.strictObject({
  layer: refSchema,
  ffx: relPathSchema,
});

const fxAddParams = z.strictObject({
  layer: refSchema,
  matchName: z.string().min(1).max(128),
  name: nameSchema.optional(),
  params: z
    .record(
      z.string().min(1).max(128),
      z.union([z.number(), z.array(z.number()).min(1).max(4), z.boolean(), z.string().max(2000)]),
    )
    .optional(),
  enabled: z.boolean().optional(),
});

const captionsBuildParams = z.strictObject({
  comp: refSchema,
  words: z
    .array(
      z.strictObject({
        text: z.string().min(1).max(200),
        start: timeSchema,
        end: timeSchema,
      }),
    )
    .min(1)
    .max(20_000),
  style: slugSchema,
  pos: vec2Schema,
  max_words: z.number().int().min(1).max(12),
  box_w: z.number().positive().max(30_000),
});

const audioDuckParams = z.strictObject({
  music_layer: refSchema,
  voice_layer: refSchema,
  amount_db: z.number().min(-60).max(0),
  segments: z.array(z.strictObject({ start: timeSchema, end: timeSchema })).max(10_000),
  fade: z.number().min(0).max(5),
});

const layerNameSchema = z.string().min(1).max(255);

const templateSlotBinding = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), layer: layerNameSchema, text: z.string().max(2000) }),
  z.strictObject({
    type: z.literal("media"),
    layer: layerNameSchema,
    item: refSchema,
    fit: z.enum(["cover", "contain", "stretch", "none"]),
  }),
  z.strictObject({ type: z.literal("color"), egp: layerNameSchema, color: hexColorSchema }),
]);

const templateInstantiateParams = z.strictObject({
  template: slugSchema,
  /** Shablon versiyasi: import qilingan loyiha papkasi shu bilan belgilanadi (`tpl.<slug>.v<n>`). */
  version: z.number().int().min(1).max(100_000),
  file: relPathSchema,
  /** `template.aep` ichidagi asosiy comp nomi. */
  template_comp: layerNameSchema,
  slots: z.array(templateSlotBinding).max(100),
  comp: refSchema,
  start: timeSchema,
  dur: durSchema.optional(),
  /** `time_remap` — shablon davomiyligi sahnaga cho'ziladi/qisqaradi. */
  stretch: z.enum(["time_remap", "none"]),
  name: layerNameSchema.optional(),
});

const framesCaptureParams = z.strictObject({
  comp: refSchema,
  times: z.array(timeSchema).min(1).max(100),
  dir: relPathSchema,
});

const renderQueueParams = z.strictObject({
  comp: refSchema,
  preset: slugSchema,
  out: relPathSchema,
});

/** Op nomi → params sxemasi. */
export const OP_PARAMS_SCHEMAS = {
  ping: pingParams,
  info: infoParams,
  undo: undoParams,
  "project.open_or_create": projectOpenOrCreateParams,
  "project.save": projectSaveParams,
  "item.import": itemImportParams,
  "comp.create": compCreateParams,
  "comp.nest": compNestParams,
  "layer.add_media": layerAddMediaParams,
  "layer.add_text": layerAddTextParams,
  "layer.add_shape": layerAddShapeParams,
  "layer.add_audio": layerAddAudioParams,
  "prop.keyframes": propKeyframesParams,
  "prop.expression": propExpressionParams,
  "fx.apply_preset": fxApplyPresetParams,
  "fx.add": fxAddParams,
  "captions.build": captionsBuildParams,
  "audio.duck": audioDuckParams,
  "template.instantiate": templateInstantiateParams,
  "frames.capture": framesCaptureParams,
  "render.queue": renderQueueParams,
  "layer.add_solid": layerAddSolidParams,
  "layer.set": layerSetParams,
  "layer.mask": layerMaskParams,
  "fx.catalog": fxCatalogParams,
  "fx.params": fxParamsParams,
  "layer.inspect": layerInspectParams,
} as const;

// ---------------------------------------------------------------- konvert

const timeoutSchema = z.number().int().min(100).max(3_600_000);

function envelope<N extends Ae.AeOpName>(name: N) {
  return z.strictObject({
    op_id: opIdSchema,
    seq: z.number().int().min(0),
    op: z.literal(name),
    params: OP_PARAMS_SCHEMAS[name],
    scene_id: slugSchema.optional(),
    timeout_ms: timeoutSchema,
  });
}

export const opEnvelopeSchema = z.discriminatedUnion(
  "op",
  [
    envelope("ping"),
    envelope("info"),
    envelope("undo"),
    envelope("project.open_or_create"),
    envelope("project.save"),
    envelope("item.import"),
    envelope("comp.create"),
    envelope("comp.nest"),
    envelope("layer.add_media"),
    envelope("layer.add_text"),
    envelope("layer.add_shape"),
    envelope("layer.add_audio"),
    envelope("prop.keyframes"),
    envelope("prop.expression"),
    envelope("fx.apply_preset"),
    envelope("fx.add"),
    envelope("captions.build"),
    envelope("audio.duck"),
    envelope("template.instantiate"),
    envelope("frames.capture"),
    envelope("render.queue"),
    envelope("layer.add_solid"),
    envelope("layer.set"),
    envelope("layer.mask"),
    envelope("fx.catalog"),
    envelope("fx.params"),
    envelope("layer.inspect"),
  ],
  { error: "Noma'lum op. Ruxsat etilganlar: " + [...SYSTEM_OP_NAMES, ...OP_NAMES].join(", ") },
);

export const opTargetSchema = z.strictObject({
  kind: z.enum(["project", "comp", "footage", "folder", "layer", "render", "frames"]),
  id: z.number().int().optional(),
  index: z.number().int().optional(),
  comp_id: z.number().int().optional(),
  name: z.string().optional(),
});

export const opResultDataSchema = z.strictObject({
  op_id: opIdSchema,
  reused: z.boolean(),
  target: opTargetSchema.optional(),
  info: z.record(z.string(), z.unknown()).optional(),
  undo_group: opIdSchema.optional(),
});

export function parseOpEnvelope(input: unknown): Result<Ae.OpEnvelope> {
  return parseWith(opEnvelopeSchema, input, "AE_BAD_PARAMS");
}

/** Konvert yasash: timeout berilmasa op bo'yicha default. */
export function makeOp<N extends Ae.AeOpName>(
  op: N,
  opId: string,
  seq: number,
  params: Ae.OpParamsMap[N],
  extra: { scene_id?: string; timeout_ms?: number } = {},
): Ae.OpEnvelopeOf<N> {
  const env: Ae.OpEnvelopeOf<N> = {
    op_id: opId,
    seq,
    op,
    params,
    timeout_ms: extra.timeout_ms ?? opTimeoutMs(op),
  };
  if (extra.scene_id !== undefined) env.scene_id = extra.scene_id;
  return env;
}

// ---------------------------------------------------------------- tip mosligi (compile vaqtida)

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type MutualCheck<T extends true> = T;

type ParamsMatch = {
  [N in Ae.AeOpName]: Mutual<z.output<(typeof OP_PARAMS_SCHEMAS)[N]>, Ae.OpParamsMap[N]>;
};
export type _OpParamsAreInSync = MutualCheck<ParamsMatch[Ae.AeOpName]>;
export type _OpEnvelopeIsInSync = MutualCheck<
  Mutual<z.output<typeof opEnvelopeSchema>, Ae.OpEnvelope>
>;
export type _OpResultIsInSync = MutualCheck<
  Mutual<z.output<typeof opResultDataSchema>, Ae.OpResultData>
>;
export type _OpNamesAreInSync = MutualCheck<
  Mutual<OpName | (typeof SYSTEM_OP_NAMES)[number], Ae.AeOpName>
>;
