/**
 * Op tili (ae-studio-plan.md §10.1) va panel ↔ ExtendScript ko'prigi kontrakti.
 *
 * DIQQAT: faqat tiplar. ExtendScript (ES3, `noLib`) dasturi ham shu faylni import qiladi,
 * shuning uchun bu yerda runtime kod, zod va lib utility tiplari (Record, Partial...) yo'q.
 * Zod sxemalari `ops.ts` da va ular shu tiplarga compile vaqtida tenglashtiriladi.
 */
import type { AesError } from "./errors";

/** Boshqa elementga havola: o'sha elementni yaratgan opning `op_id` si. */
export type Ref = string;

/** Piksel koordinata yoki o'lcham: [x, y] / [w, h]. */
export type Vec2 = [number, number];

/** `#RRGGBB`. */
export type HexColor = string;

/** Ish papkasiga nisbiy yo'l (`source/clip.mp4`). Absolyut yo'l va `..` taqiqlangan. */
export type RelPath = string;

export type Fit = "cover" | "contain" | "stretch" | "none";
export type Ease = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "hold";
export type PropAlias = "position" | "scale" | "rotation" | "opacity" | "anchor_point";
/** Alias yoki matchName yo'li: `ADBE Transform Group/ADBE Position`. */
export type PropPath = string;
export type ScalarValue = string | number | boolean;

export interface PingParams {
  /** Javobga qaytariladigan ixtiyoriy belgi. */
  echo?: string | undefined;
}

/** `ae_info`: AE versiyasi, ochiq loyiha, comp'lar va shriftlar (parametrsiz). */
export type InfoParams = { [key: string]: never };

/** Live ekranidagi "Undo last": faqat AE'dagi oxirgi undo group shu op bo'lsa bekor qilinadi. */
export interface UndoParams {
  op_id: string;
}

export interface ProjectOpenOrCreateParams {
  path: RelPath;
}

export interface ProjectSaveParams {
  version: number;
  path: RelPath;
}

export interface ItemImportParams {
  file: RelPath;
  /** Project panelidagi papka nomi. */
  folder?: string | undefined;
}

export interface CompCreateParams {
  name: string;
  w: number;
  h: number;
  fps: number;
  /** Soniya. */
  dur: number;
  bg?: HexColor | undefined;
  folder?: string | undefined;
}

export interface CompNestParams {
  child: Ref;
  parent: Ref;
  start: number;
  dur?: number | undefined;
  name?: string | undefined;
}

export interface LayerAddMediaParams {
  comp: Ref;
  item: Ref;
  start: number;
  dur?: number | undefined;
  fit: Fit;
  name?: string | undefined;
  pos?: Vec2 | undefined;
  opacity?: number | undefined;
  keep_audio?: boolean | undefined;
}

export interface TextStyleOp {
  font?: string | undefined;
  size?: number | undefined;
  color?: HexColor | undefined;
  justify?: "left" | "center" | "right" | undefined;
  tracking?: number | undefined;
  leading?: number | undefined;
  stroke_color?: HexColor | undefined;
  stroke_width?: number | undefined;
  all_caps?: boolean | undefined;
}

export interface LayerAddTextParams {
  comp: Ref;
  text: string;
  start: number;
  dur?: number | undefined;
  name?: string | undefined;
  style: TextStyleOp;
  pos: Vec2;
  /** Paragraf matn qutisi [w, h]; berilmasa nuqtali matn. */
  box?: Vec2 | undefined;
}

export interface LayerAddShapeParams {
  comp: Ref;
  kind: "rect" | "ellipse";
  color: HexColor;
  size: Vec2;
  pos: Vec2;
  start: number;
  dur?: number | undefined;
  name?: string | undefined;
  radius?: number | undefined;
  opacity?: number | undefined;
}

export interface LayerAddAudioParams {
  comp: Ref;
  item: Ref;
  start: number;
  /** dB. */
  volume: number;
  dur?: number | undefined;
  name?: string | undefined;
}

export interface Keyframe {
  /** Soniya; `relative` bo'lsa layer boshidan. */
  t: number;
  v: number | number[] | string;
}

export interface PropKeyframesParams {
  layer: Ref;
  prop: PropPath;
  keys: Keyframe[];
  ease: Ease;
  relative: boolean;
}

export interface PropExpressionParams {
  layer: Ref;
  prop: PropPath;
  /** Faqat kutubxonadagi expression id (masalan `wiggle`). */
  expr_id: string;
  args?: { [name: string]: ScalarValue } | undefined;
}

export interface FxApplyPresetParams {
  layer: Ref;
  ffx: RelPath;
}

export interface FxAddParams {
  layer: Ref;
  matchName: string;
  name?: string | undefined;
  params?: { [prop: string]: number | number[] | boolean | string } | undefined;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface CaptionsBuildParams {
  comp: Ref;
  words: CaptionWord[];
  style: string;
  pos: Vec2;
  max_words: number;
  /** Matn qutisi eni, piksel. */
  box_w: number;
}

export interface TimeSpan {
  start: number;
  end: number;
}

export interface AudioDuckParams {
  music_layer: Ref;
  voice_layer: Ref;
  amount_db: number;
  /** Ovoz eshitiladigan oraliqlar (TTS timestamps'dan). */
  segments: TimeSpan[];
  /** Pasayish/ko'tarilish davomiyligi, soniya. */
  fade: number;
}

export type TemplateSlotBinding =
  | { type: "text"; layer: string; text: string }
  | { type: "media"; layer: string; item: Ref; fit: "cover" | "contain" | "stretch" | "none" }
  | { type: "color"; egp: string; color: HexColor };

export interface TemplateInstantiateParams {
  template: string;
  version: number;
  /** Shablon `.aep` fayli (ish papkasiga nisbiy). */
  file: RelPath;
  /** `template.aep` ichidagi asosiy comp nomi. */
  template_comp: string;
  slots: TemplateSlotBinding[];
  comp: Ref;
  start: number;
  dur?: number | undefined;
  stretch: "time_remap" | "none";
  name?: string | undefined;
}

export interface FramesCaptureParams {
  comp: Ref;
  /** Soniya. */
  times: number[];
  /** Kadrlar yoziladigan nisbiy papka. */
  dir: RelPath;
}

export interface RenderQueueParams {
  comp: Ref;
  preset: string;
  out: RelPath;
}

/** Op nomi → parametrlari. `ping`, `undo` — tizim oplari (Spec'dan kompilyatsiya qilinmaydi). */
export interface OpParamsMap {
  ping: PingParams;
  info: InfoParams;
  undo: UndoParams;
  "project.open_or_create": ProjectOpenOrCreateParams;
  "project.save": ProjectSaveParams;
  "item.import": ItemImportParams;
  "comp.create": CompCreateParams;
  "comp.nest": CompNestParams;
  "layer.add_media": LayerAddMediaParams;
  "layer.add_text": LayerAddTextParams;
  "layer.add_shape": LayerAddShapeParams;
  "layer.add_audio": LayerAddAudioParams;
  "prop.keyframes": PropKeyframesParams;
  "prop.expression": PropExpressionParams;
  "fx.apply_preset": FxApplyPresetParams;
  "fx.add": FxAddParams;
  "captions.build": CaptionsBuildParams;
  "audio.duck": AudioDuckParams;
  "template.instantiate": TemplateInstantiateParams;
  "frames.capture": FramesCaptureParams;
  "render.queue": RenderQueueParams;
}

export type AeOpName = keyof OpParamsMap;

/** `{ op_id, seq, op, params, scene_id, timeout_ms }` (§10.1). */
export interface OpEnvelopeOf<N extends AeOpName> {
  op_id: string;
  seq: number;
  op: N;
  params: OpParamsMap[N];
  scene_id?: string | undefined;
  timeout_ms: number;
}

export type OpEnvelope = { [N in AeOpName]: OpEnvelopeOf<N> }[AeOpName];

export type TargetKind = "project" | "comp" | "footage" | "folder" | "layer" | "render" | "frames";

export interface OpTarget {
  kind: TargetKind;
  /** AE item id (comp, footage, folder). */
  id?: number | undefined;
  /** Layer indeksi (1 dan) — faqat ma'lumot uchun; havola op_id orqali. */
  index?: number | undefined;
  /** Layer joylashgan comp'ning item id si. */
  comp_id?: number | undefined;
  name?: string | undefined;
}

export interface OpResultData {
  op_id: string;
  /** true — op avval bajarilgan (izi topildi) va qayta yaratilmadi. */
  reused: boolean;
  target?: OpTarget | undefined;
  /** Opga xos qo'shimcha natija (ping ma'lumotlari, kadr yo'llari ...). */
  info?: { [key: string]: unknown } | undefined;
}

/** Panel → ExtendScript: `runOp(JSON.stringify(AeRequest))`. */
export interface AeRequest {
  op: OpEnvelope;
  ctx: AeContext;
}

export interface AeContext {
  /** Ish papkasining absolyut yo'li (`/` ajratgich bilan). */
  root: string;
}

/** ExtendScript → panel (JSON string). */
export type AeResponse = { ok: true; data: OpResultData } | { ok: false; error: AesError };
