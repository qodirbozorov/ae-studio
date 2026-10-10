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
/** Segment egri chizig'i (P6.03): token (`enter`, `$pop` …), `[x1,y1,x2,y2]` yoki xom `{ in, out }`. */
export type EaseCurve =
  string | [number, number, number, number] | { in: [number, number]; out: [number, number] };
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
  dirty?: "autosave" | "fail" | undefined;
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
  /** `fit` natijasiga ko'paytiruvchi. */
  scale?: number | undefined;
  name?: string | undefined;
  pos?: Vec2 | undefined;
  opacity?: number | undefined;
  keep_audio?: boolean | undefined;
  /** Vektor footage (PDF/AI): "Continuously Rasterize" — har masshtabda tiniq. */
  vector?: boolean | undefined;
  /** Vektor qatlamni AE shape qatlamiga aylantirish (Create Shapes from Vector Layer). */
  as_shapes?: boolean | undefined;
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
  /** Oddiy shakl (v1): kind + color + size. */
  kind?: "rect" | "ellipse" | undefined;
  color?: HexColor | undefined;
  size?: Vec2 | undefined;
  /** Professional contents (Faza 7). */
  contents?: ShapeContentOp[] | undefined;
  /** Gradient ranglari: G-Fill/G-Stroke oq → qora, qatlam Tint'i oq → [0], qora → [1]. */
  gradient_colors?: [HexColor, HexColor] | undefined;
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
  /** Oldingi kalitdan shu kalitgacha bo'lgan segment ease'i (op `ease` ini almashtiradi). */
  ease?: EaseCurve | undefined;
}

export interface PropKeyframesParams {
  layer: Ref;
  prop: PropPath;
  keys: Keyframe[];
  /** Eski qiymatlar (`ease_in` …) — har kalitga; yangi (token/bezier/xom) — segment bo'yicha (§11-B). */
  ease: Ease | EaseCurve;
  relative: boolean;
  /** Spatial yo'l: `linear` (sukut, tangentlar 0) yoki `auto`. */
  spatial?: "linear" | "auto" | undefined;
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
  /** Kalit: 1-indeks ("3"), matchName yoki ko'rinadigan nom. Rang — `#RRGGBB`. */
  params?: { [prop: string]: number | number[] | boolean | string } | undefined;
  enabled?: boolean | undefined;
}

/** Shape yo'li (op ko'rinishi): tangentlar nuqtaga nisbatan. Kompilyator svg_d/rect'ni shunga o'giradi. */
export interface ShapePathOp {
  points: Vec2[];
  in: Vec2[];
  out: Vec2[];
  closed: boolean;
}

/** Gradient (G-Fill/G-Stroke oq → qora; ranglar qatlam darajasidagi Tint bilan, `gradient_colors`). */
export interface ShapeGradientOp {
  type: "linear" | "radial";
  start: Vec2;
  end: Vec2;
}

export interface ShapeFillOp {
  color?: HexColor | undefined;
  gradient?: ShapeGradientOp | undefined;
  opacity?: number | undefined;
  rule?: "nonzero" | "evenodd" | undefined;
}

export interface ShapeStrokeOp {
  color?: HexColor | undefined;
  gradient?: ShapeGradientOp | undefined;
  opacity?: number | undefined;
  width: number;
  cap?: "butt" | "round" | "square" | undefined;
  join?: "miter" | "round" | "bevel" | undefined;
  miter_limit?: number | undefined;
  dashes?: number[] | undefined;
  dash_offset?: number | undefined;
}

export interface ShapeRepeaterOp {
  copies: number;
  offset?: number | undefined;
  position?: Vec2 | undefined;
  scale?: Vec2 | undefined;
  rotation?: number | undefined;
  start_opacity?: number | undefined;
  end_opacity?: number | undefined;
  composite?: "above" | "below" | undefined;
}

export interface ShapeTransformOp {
  anchor?: Vec2 | undefined;
  position?: Vec2 | undefined;
  scale?: Vec2 | undefined;
  rotation?: number | undefined;
  opacity?: number | undefined;
  skew?: number | undefined;
  skew_axis?: number | undefined;
}

/** Bitta AE vector group (`name` = id). Stek: yo'l → modifikatorlar → stroke → fill → repeater. */
export interface ShapeContentOp {
  id: string;
  kind: "rect" | "ellipse" | "star" | "polygon" | "path" | "group";
  size?: Vec2 | undefined;
  position?: Vec2 | undefined;
  roundness?: number | undefined;
  points?: number | undefined;
  outer_radius?: number | undefined;
  inner_radius?: number | undefined;
  outer_roundness?: number | undefined;
  inner_roundness?: number | undefined;
  rotation?: number | undefined;
  paths?: ShapePathOp[] | undefined;
  fill?: ShapeFillOp | undefined;
  stroke?: ShapeStrokeOp | undefined;
  trim?:
    | {
        start?: number | undefined;
        end?: number | undefined;
        offset?: number | undefined;
        individually?: boolean | undefined;
      }
    | undefined;
  round_corners?: number | undefined;
  offset_paths?: { amount: number; join?: "miter" | "round" | "bevel" | undefined } | undefined;
  merge?: "merge" | "add" | "subtract" | "intersect" | "exclude" | undefined;
  zig_zag?: { size: number; ridges?: number | undefined; smooth?: boolean | undefined } | undefined;
  pucker_bloat?: number | undefined;
  twist?: { angle: number; center?: Vec2 | undefined } | undefined;
  wiggle?:
    | {
        size: number;
        detail?: number | undefined;
        speed?: number | undefined;
        seed?: number | undefined;
      }
    | undefined;
  repeater?: ShapeRepeaterOp | undefined;
  transform?: ShapeTransformOp | undefined;
  contents?: ShapeContentOp[] | undefined;
}

export interface LayerAddSolidParams {
  comp: Ref;
  kind: "solid" | "null" | "adjustment";
  color?: HexColor | undefined;
  /** Piksel; berilmasa comp o'lchami. */
  size?: Vec2 | undefined;
  pos: Vec2;
  start: number;
  dur?: number | undefined;
  name?: string | undefined;
  opacity?: number | undefined;
}

export type MatteTypeName = "alpha" | "alpha_inverted" | "luma" | "luma_inverted";

export interface LayerTransformOp {
  anchor?: number[] | undefined;
  position?: number[] | undefined;
  scale?: number[] | undefined;
  rotation?: number | undefined;
  opacity?: number | undefined;
  rotation_x?: number | undefined;
  rotation_y?: number | undefined;
  orientation?: number[] | undefined;
}

/** Qatlam xususiyatlari (Faza 7): 3D, transform, blend, parent, matte. */
export interface LayerSetParams {
  layer: Ref;
  three_d?: boolean | undefined;
  motion_blur?: boolean | undefined;
  transform?: LayerTransformOp | undefined;
  /** `normal`, `screen`, `multiply` … (AE BlendingMode, kichik harf va `_`). */
  blend?: string | undefined;
  parent?: Ref | undefined;
  matte?: { source: Ref; type: MatteTypeName } | undefined;
}

export type MaskModeName =
  "add" | "subtract" | "intersect" | "lighten" | "darken" | "difference" | "none";

export interface LayerMaskParams {
  layer: Ref;
  /** Maska nomi (keyframe yo'li `masks.<id>.*`). */
  id: string;
  path: ShapePathOp;
  mode: MaskModeName;
  feather?: Vec2 | undefined;
  expansion?: number | undefined;
  opacity?: number | undefined;
  inverted?: boolean | undefined;
}

/** O'rnatilgan effektlar ro'yxati (`app.effects`), nom/matchName/kategoriya bo'yicha qidiruv. */
export interface FxCatalogParams {
  query?: string | undefined;
  limit?: number | undefined;
}

/** Effekt parametrlari: vaqtinchalik solid'ga qo'shib, nom/indeks/turini o'qiydi. */
export interface FxParamsParams {
  match_name: string;
}

/** Qurilgan qatlam/comp tuzilmasi (AES.dump). */
export interface LayerInspectParams {
  comp?: string | undefined;
  layer?: string | undefined;
  ref?: Ref | undefined;
  depth?: number | undefined;
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
  "layer.add_solid": LayerAddSolidParams;
  "layer.set": LayerSetParams;
  "layer.mask": LayerMaskParams;
  "fx.catalog": FxCatalogParams;
  "fx.params": FxParamsParams;
  "layer.inspect": LayerInspectParams;
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
  /**
   * Batch'da op bajarilgan AE undo group'i (`aes:<undo_group>`, guruhdagi birinchi op_id). Undo shu
   * guruhni butunligicha bekor qiladi (P6.04). Bittalik opda yo'q (guruh = op_id).
   */
  undo_group?: string | undefined;
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

/** Sahna batch'i (P6.04): oplar bitta evalScript'da ketma-ket, birinchi xatoda to'xtaydi. */
export interface AeBatchRequest {
  ops: OpEnvelope[];
  ctx: AeContext;
  /** Log uchun nom (odatda sahna id'si); undo group nomi — guruhdagi birinchi op_id. */
  label?: string | undefined;
}

export type AeBatchItem =
  | { op_id: string; ok: true; data: OpResultData; ms: number }
  | { op_id: string; ok: false; error: AesError; ms: number };

/** Natijalar bajarilgan oplar uchun (xato bo'lgan op oxirgisi); qolganlari bajarilmagan. */
export type AeBatchResponse =
  { ok: true; data: { results: AeBatchItem[]; ms: number } } | { ok: false; error: AesError };
