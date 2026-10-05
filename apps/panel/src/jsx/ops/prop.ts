/** Property oplari: keyframe'lar (ease bilan) va kutubxonadan expression. */
import type { Ease, OpResultData, PropExpressionParams, PropKeyframesParams } from "@aes/shared/ae";
import { buildExpression } from "../lib/expressions";
import { hasLayerTag, requireLayer, stampLayer } from "../lib/trace";
import { raise } from "../lib/util";

const ALIASES: { [alias: string]: string[] | undefined } = {
  position: ["ADBE Transform Group", "ADBE Position"],
  scale: ["ADBE Transform Group", "ADBE Scale"],
  rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
  opacity: ["ADBE Transform Group", "ADBE Opacity"],
  anchor_point: ["ADBE Transform Group", "ADBE Anchor Point"],
};

/** Alias yoki `matchName/matchName/...` (raqamli segment — 1-indeks) → Property. */
export function resolveProperty(layer: Layer, path: string): Property {
  const segments = ALIASES[path] ?? path.split("/");
  let current: PropertyBase = layer;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string;
    const group = current as PropertyGroup;
    let next: PropertyBase | null;
    try {
      next = /^\d+$/.test(segment)
        ? group.property(parseInt(segment, 10))
        : group.property(segment);
    } catch (_e) {
      next = null;
    }
    if (next === null || next === undefined) {
      return raise("AE_NOT_FOUND", "Property topilmadi: " + path + " (" + segment + ")");
    }
    current = next;
  }
  return current as Property;
}

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
  for (let i = 0; i < p.keys.length; i++) {
    const key = p.keys[i]!;
    const time = p.relative ? layer.inPoint + key.t : key.t;
    prop.setValueAtTime(time, key.v as never);
    // setValueAtTime hech narsa qaytarmaydi: kalit indeksi vaqt bo'yicha olinadi.
    applyEase(prop, prop.nearestKeyIndex(time), p.ease);
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
  prop.expression = buildExpression(p.expr_id, p.args);
  stampLayer(layer, opId);
  result.reused = false;
  return result;
}
