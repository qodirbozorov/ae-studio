/** Property oplari: keyframe'lar (ease bilan) va kutubxonadan expression. */
import type { Ease, OpResultData, PropExpressionParams, PropKeyframesParams } from "@aes/shared/ae";
import { buildExpression } from "../lib/expressions";
import { resolvePath, toAeValue } from "../lib/props";
import { anim } from "../lib/runtime";
import type { AnimKey } from "../lib/runtime";
import { hasLayerTag, requireLayer, stampLayer } from "../lib/trace";
import { raise } from "../lib/util";

/** Eski nom (shablon oplari uchun): xususiyat yo'li → Property. */
export const resolveProperty = resolvePath;

/** v1 ease qiymatlari: har kalitga alohida (eski xulq o'zgarmaydi). */
const LEGACY: { [ease: string]: boolean | undefined } = {
  linear: true,
  hold: true,
  ease_in: true,
  ease_out: true,
  ease_in_out: true,
};

function easeDimensions(prop: Property): number {
  const type = prop.propertyValueType;
  if (type === PropertyValueType.TwoD) return 2;
  if (type === PropertyValueType.ThreeD) return 3;
  return 1;
}

function applyEase(prop: Property, index: number, ease: Ease): void {
  if (ease === "hold") {
    prop.setInterpolationTypeAtKey(
      index,
      KeyframeInterpolationType.HOLD,
      KeyframeInterpolationType.HOLD,
    );
    return;
  }
  if (ease === "linear") {
    prop.setInterpolationTypeAtKey(
      index,
      KeyframeInterpolationType.LINEAR,
      KeyframeInterpolationType.LINEAR,
    );
    return;
  }
  prop.setInterpolationTypeAtKey(
    index,
    KeyframeInterpolationType.BEZIER,
    KeyframeInterpolationType.BEZIER,
  );
  // ease_in: kalitga sekin kiradi; ease_out: kalitdan sekin chiqadi.
  const slowIn = ease === "ease_in" || ease === "ease_in_out" ? 75 : 16.67;
  const slowOut = ease === "ease_out" || ease === "ease_in_out" ? 75 : 16.67;
  const inEase: KeyframeEase[] = [];
  const outEase: KeyframeEase[] = [];
  const dims = easeDimensions(prop);
  for (let d = 0; d < dims; d++) {
    inEase.push(new KeyframeEase(0, slowIn));
    outEase.push(new KeyframeEase(0, slowOut));
  }
  // types-for-adobe kortej talab qiladi; uzunlik `easeDimensions` bilan to'g'ri.
  prop.setTemporalEaseAtKey(
    index,
    inEase as unknown as [KeyframeEase],
    outEase as unknown as [KeyframeEase],
  );
}

/** `prop.keyframes` — vaqtlar `relative` bo'lsa layer boshidan. Iz layer comment'ida. */
export function propKeyframes(p: PropKeyframesParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer);
  const result: OpResultData = {
    op_id: opId,
    reused: true,
    target: { kind: "layer", name: layer.name },
  };
  if (hasLayerTag(layer, opId)) return result;
  const prop = resolveProperty(layer, p.prop);
  let segmented = typeof p.ease !== "string" || LEGACY[p.ease] !== true;
  for (let i = 0; i < p.keys.length && !segmented; i++) {
    if (p.keys[i]!.ease !== undefined) segmented = true;
  }
  if (segmented) {
    // P6.03: segment ease (token/bezier/xom) — runtime `AES.anim`, setValuesAtTimes bilan.
    const keys: AnimKey[] = [];
    for (let i = 0; i < p.keys.length; i++) {
      const key = p.keys[i]!;
      keys.push([p.relative ? layer.inPoint + key.t : key.t, toAeValue(key.v), key.ease]);
    }
    // Kalitda ease bo'lmasa: v1 ease_* → "soft" (AE Easy Ease), linear/hold — o'zi.
    const fallback = typeof p.ease === "string" && p.ease.indexOf("ease_") === 0 ? "soft" : p.ease;
    anim(prop, keys, fallback, { spatial: p.spatial });
    stampLayer(layer, opId);
    result.reused = false;
    result.info = { keys: p.keys.length };
    return result;
  }
  for (let i = 0; i < p.keys.length; i++) {
    const key = p.keys[i]!;
    const time = p.relative ? layer.inPoint + key.t : key.t;
    prop.setValueAtTime(time, toAeValue(key.v) as never);
    // setValueAtTime hech narsa qaytarmaydi: kalit indeksi vaqt bo'yicha olinadi.
    applyEase(prop, prop.nearestKeyIndex(time), p.ease as Ease);
  }
  stampLayer(layer, opId);
  result.reused = false;
  result.info = { keys: p.keys.length };
  return result;
}

/** `prop.expression` — faqat kutubxonadagi expression (ixtiyoriy kod yo'q). */
export function propExpression(p: PropExpressionParams, opId: string): OpResultData {
  const layer = requireLayer(p.layer);
  const result: OpResultData = {
    op_id: opId,
    reused: true,
    target: { kind: "layer", name: layer.name },
  };
  if (hasLayerTag(layer, opId)) return result;
  const prop = resolveProperty(layer, p.prop);
  if (!prop.canSetExpression)
    return raise("AE_BAD_PARAMS", "Bu property'ga expression qo'yib bo'lmaydi");
  prop.expression = p.code !== undefined ? p.code : buildExpression(p.expr_id as string, p.args);
  if (p.code !== undefined && prop.expressionError) {
    return raise("AE_BAD_PARAMS", "Expression xatosi (" + p.prop + "): " + prop.expressionError);
  }
  stampLayer(layer, opId);
  result.reused = false;
  return result;
}
