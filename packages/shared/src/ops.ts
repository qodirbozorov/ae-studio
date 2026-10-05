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
] as const;

/** Tizim oplari: diagnostika uchun, Spec'dan chiqmaydi. */
export const SYSTEM_OP_NAMES = ["ping"] as const;

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

// ---------------------------------------------------------------- op parametrlari

const pingParams = z.strictObject({ echo: z.string().max(200).optional() });

const projectOpenOrCreateParams = z.strictObject({ path: relPathSchema });

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
  name: nameSchema.optional(),
  pos: vec2Schema.optional(),
  opacity: z.number().min(0).max(100).optional(),
  keep_audio: z.boolean().optional(),
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
  kind: z.enum(["rect", "ellipse"]),
  color: hexColorSchema,
  size: sizeSchema,
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

const keyframeSchema = z.strictObject({
  t: z.number().min(-36_000).max(36_000),
  v: z.union([z.number(), z.array(z.number()).min(1).max(4), z.string().max(5000)]),
});

const propKeyframesParams = z.strictObject({
  layer: refSchema,
  prop: propPathSchema,
  keys: z.array(keyframeSchema).min(1).max(1000),
  ease: z.enum(["linear", "ease_in", "ease_out", "ease_in_out", "hold"]),
  relative: z.boolean(),
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

const templateInstantiateParams = z.strictObject({
  template: slugSchema,
  file: relPathSchema,
  slots: z.record(z.string().min(1).max(64), scalarSchema),
  comp: refSchema,
  start: timeSchema,
  dur: durSchema.optional(),
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
  ],
  { error: "Noma'lum op. Ruxsat etilganlar: " + ["ping", ...OP_NAMES].join(", ") },
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
