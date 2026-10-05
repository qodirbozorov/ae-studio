/**
 * Idempotentlik izi (§2.5, §10.3): har yaratilgan item/layer comment'iga `[aes:<op_id>]` yoziladi.
 * Resume va patch'da `find*ByOpId` shu iz bo'yicha mavjud elementni topadi — dublikat yaratilmaydi.
 */
import { raise } from "./util";

export function traceTag(opId: string): string {
  return "[aes:" + opId + "]";
}

function hasTag(comment: string, opId: string): boolean {
  return comment.indexOf(traceTag(opId)) >= 0;
}

function withTag(comment: string, opId: string): string {
  if (hasTag(comment, opId)) return comment;
  return comment === "" ? traceTag(opId) : comment + "\n" + traceTag(opId);
}

export function stampItem(item: _ItemClasses, opId: string): void {
  item.comment = withTag(item.comment, opId);
}

/** Layer ustida bajarilgan op izi (keyframe, effekt, expression kabi yaratmaydigan oplar uchun). */
export function hasLayerTag(layer: Layer, opId: string): boolean {
  return hasTag(layer.comment, opId);
}

export function stampLayer(layer: Layer, opId: string): void {
  layer.comment = withTag(layer.comment, opId);
}

export function findItemByOpId(opId: string): _ItemClasses | null {
  const items = app.project.numItems;
  for (let i = 1; i <= items; i++) {
    const item = app.project.item(i);
    if (hasTag(item.comment, opId)) return item;
  }
  return null;
}

export function findLayerInComp(comp: CompItem, opId: string): Layer | null {
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    if (hasTag(layer.comment, opId)) return layer;
  }
  return null;
}

/** Layer'ni barcha comp'lardan qidiradi (havola faqat op_id bo'lganda). */
export function findLayerByOpId(opId: string): Layer | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem) {
      const layer = findLayerInComp(item, opId);
      if (layer !== null) return layer;
    }
  }
  return null;
}

/** Havola qilingan comp (uni yaratgan opning op_id si bo'yicha); topilmasa AE_NOT_FOUND. */
export function requireComp(ref: string): CompItem {
  const item = findItemByOpId(ref);
  if (item === null || !(item instanceof CompItem)) {
    return raise("AE_NOT_FOUND", "Comp topilmadi: " + ref);
  }
  return item;
}

export function requireItem(ref: string): _ItemClasses {
  const item = findItemByOpId(ref);
  if (item === null) return raise("AE_NOT_FOUND", "Element topilmadi: " + ref);
  return item;
}

/** Havola qilingan layer (uni yaratgan opning op_id si bo'yicha); topilmasa AE_NOT_FOUND. */
export function requireLayer(ref: string): Layer {
  const layer = findLayerByOpId(ref);
  if (layer === null) return raise("AE_NOT_FOUND", "Layer topilmadi: " + ref);
  return layer;
}
