import type {
  LayerAddAudioParams,
  LayerAddMediaParams,
  LayerAddShapeParams,
  LayerAddTextParams,
  OpResultData,
  TextStyleOp,
} from "@aes/shared/ae";
import { layerResult, requireAvItem, setLayerTiming, transformProperty } from "../lib/ae";
import { findLayerInComp, requireComp, requireItem, stampLayer } from "../lib/trace";
import { hexToRgb, raise } from "../lib/util";

function applyTextStyle(layer: TextLayer, style: TextStyleOp): void {
  const group = layer.property("ADBE Text Properties") as PropertyGroup;
  const prop = group.property("ADBE Text Document") as TextDocumentProperty;
  const doc = prop.value;
  if (style.font !== undefined) doc.font = style.font;
  if (style.size !== undefined) doc.fontSize = style.size;
  if (style.color !== undefined) {
    doc.applyFill = true;
    doc.fillColor = hexToRgb(style.color);
  }
  if (style.stroke_color !== undefined || style.stroke_width !== undefined) {
    doc.applyStroke = true;
    if (style.stroke_color !== undefined) doc.strokeColor = hexToRgb(style.stroke_color);
    if (style.stroke_width !== undefined) doc.strokeWidth = style.stroke_width;
    doc.strokeOverFill = false;
  }
  if (style.justify === "left") doc.justification = ParagraphJustification.LEFT_JUSTIFY;
  if (style.justify === "center") doc.justification = ParagraphJustification.CENTER_JUSTIFY;
  if (style.justify === "right") doc.justification = ParagraphJustification.RIGHT_JUSTIFY;
  if (style.tracking !== undefined) doc.tracking = style.tracking;
  if (style.leading !== undefined) doc.leading = style.leading;
  prop.setValue(doc);
}

/** `layer.add_text` — nuqtali yoki (box berilsa) paragraf matn. */
export function layerAddText(p: LayerAddTextParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  // TextDocument.allCaps AE 22 da faqat o'qiladi — katta harfni matnning o'zida qilamiz.
  const text = p.style.all_caps === true ? p.text.toUpperCase() : p.text;
  const layer =
    p.box === undefined ? comp.layers.addText(text) : comp.layers.addBoxText(p.box, text);
  if (p.name !== undefined) layer.name = p.name;
  applyTextStyle(layer, p.style);
  transformProperty(layer, "ADBE Position").setValue(p.pos);
  setLayerTiming(layer, comp, p.start, p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}

/** `fit` bo'yicha masshtab (%): cover — to'ldiradi, contain — sig'diradi, stretch — cho'zadi. */
export function fitScale(
  fit: LayerAddMediaParams["fit"],
  item: { width: number; height: number },
  comp: { width: number; height: number },
): [number, number] {
  if (fit === "none" || item.width <= 0 || item.height <= 0) return [100, 100];
  const sx = comp.width / item.width;
  const sy = comp.height / item.height;
  if (fit === "stretch") return [sx * 100, sy * 100];
  const s = fit === "cover" ? (sx > sy ? sx : sy) : sx < sy ? sx : sy;
  return [s * 100, s * 100];
}

/** `layer.add_media` — video/rasm/nested comp. Faqat audio bo'lsa `layer.add_audio` ishlatiladi. */
export function layerAddMedia(p: LayerAddMediaParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  const item = requireAvItem(requireItem(p.item), p.item);
  if (!item.hasVideo)
    return raise("AE_BAD_PARAMS", "Faqat audio: layer.add_audio ishlating — " + p.item);

  const layer = comp.layers.add(item);
  if (p.name !== undefined) layer.name = p.name;
  transformProperty(layer, "ADBE Scale").setValue(fitScale(p.fit, item, comp));
  transformProperty(layer, "ADBE Position").setValue(
    p.pos === undefined ? [comp.width / 2, comp.height / 2] : p.pos,
  );
  if (p.opacity !== undefined) transformProperty(layer, "ADBE Opacity").setValue(p.opacity);
  if (item.hasAudio && p.keep_audio !== true) layer.audioEnabled = false;
  setLayerTiming(layer, comp, p.start, p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}

/** `layer.add_shape` — to'rtburchak (radius bilan) yoki ellips, to'ldirilgan rang. */
export function layerAddShape(p: LayerAddShapeParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  const layer = comp.layers.addShape();
  if (p.name !== undefined) layer.name = p.name;
  const contents = layer.property("ADBE Root Vectors Group") as PropertyGroup;
  const group = contents.addProperty("ADBE Vector Group") as PropertyGroup;
  const vectors = group.property("ADBE Vectors Group") as PropertyGroup;
  const rect = p.kind === "rect";
  const shape = vectors.addProperty(
    rect ? "ADBE Vector Shape - Rect" : "ADBE Vector Shape - Ellipse",
  ) as PropertyGroup;
  (
    shape.property(rect ? "ADBE Vector Rect Size" : "ADBE Vector Ellipse Size") as Property
  ).setValue(p.size);
  if (rect && p.radius !== undefined) {
    (shape.property("ADBE Vector Rect Roundness") as Property).setValue(p.radius);
  }
  const fill = vectors.addProperty("ADBE Vector Graphic - Fill") as PropertyGroup;
  (fill.property("ADBE Vector Fill Color") as Property).setValue(hexToRgb(p.color));
  transformProperty(layer, "ADBE Position").setValue(p.pos);
  if (p.opacity !== undefined) transformProperty(layer, "ADBE Opacity").setValue(p.opacity);
  setLayerTiming(layer, comp, p.start, p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}

/** `layer.add_audio` — ovoz darajasi dB da; video'li element bo'lsa tasvir o'chiriladi. */
export function layerAddAudio(p: LayerAddAudioParams, opId: string): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  const item = requireAvItem(requireItem(p.item), p.item);
  if (!item.hasAudio) return raise("AE_BAD_PARAMS", "Elementda ovoz yo'q: " + p.item);
  const layer = comp.layers.add(item);
  if (p.name !== undefined) layer.name = p.name;
  if (item.hasVideo) layer.enabled = false;
  const audio = layer.property("ADBE Audio Group") as PropertyGroup;
  (audio.property("ADBE Audio Levels") as Property).setValue([p.volume, p.volume]);
  setLayerTiming(layer, comp, p.start, p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}
