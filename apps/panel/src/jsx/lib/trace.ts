/**
 * Idempotentlik izi (§2.5, §10.3): har yaratilgan item/layer comment'iga `[aes:<op_id>]` yoziladi.
 * Resume va patch'da `find*ByOpId` shu iz bo'yicha mavjud elementni topadi — dublikat yaratilmaydi.
 *
 * Batch keshi (P6.04): sahna bitta evalScript'da bajarilganda har op loyihani qayta skanerlamasligi uchun
 * izlar bir marta o'qiladi va yangi izlar keshga qo'shiladi (aks holda 400 qatlamli sahna O(n²)).
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

interface TraceCache {
  scanned: boolean;
  items: { [opId: string]: _ItemClasses | undefined };
  layers: { [opId: string]: Layer | undefined };
}

let cache: TraceCache | null = null;

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function tagsOf(comment: string): string[] {
  const out: string[] = [];
  const re = /\[aes:([^\]]+)\]/g;
  let match = re.exec(comment);
  while (match !== null) {
    out.push(match[1] as string);
    match = re.exec(comment);
  }
  return out;
}

/** Batch boshida: kesh yoqiladi (skaner birinchi qidiruvda). */
export function beginTraceCache(): void {
  cache = { scanned: false, items: {}, layers: {} };
}

export function endTraceCache(): void {
  cache = null;
}

/** Loyiha tashqaridan o'zgarganda (shablon importi, element o'chirilishi): keyingi qidiruvda qayta skaner. */
export function resetTraceCache(): void {
  if (cache !== null) beginTraceCache();
}

function scan(c: TraceCache): void {
  // Birinchi uchragan element g'olib — kesh yo'q holatdagi chiziqli qidiruv bilan bir xil.
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    const tags = tagsOf(item.comment);
    for (let t = 0; t < tags.length; t++) if (!has(c.items, tags[t]!)) c.items[tags[t]!] = item;
    if (item instanceof CompItem) {
      for (let l = 1; l <= item.numLayers; l++) {
        const layer = item.layer(l);
        const layerTags = tagsOf(layer.comment);
        for (let t = 0; t < layerTags.length; t++) {
          if (!has(c.layers, layerTags[t]!)) c.layers[layerTags[t]!] = layer;
        }
      }
    }
  }
  c.scanned = true;
}

function ready(): TraceCache | null {
  if (cache !== null && !cache.scanned) scan(cache);
  return cache;
}

export function stampItem(item: _ItemClasses, opId: string): void {
  item.comment = withTag(item.comment, opId);
  if (cache !== null && cache.scanned && !has(cache.items, opId)) cache.items[opId] = item;
}

/** Layer ustida bajarilgan op izi (keyframe, effekt, expression kabi yaratmaydigan oplar uchun). */
export function hasLayerTag(layer: Layer, opId: string): boolean {
  return hasTag(layer.comment, opId);
}

export function stampLayer(layer: Layer, opId: string): void {
  layer.comment = withTag(layer.comment, opId);
  if (cache !== null && cache.scanned && !has(cache.layers, opId)) cache.layers[opId] = layer;
}

export function findItemByOpId(opId: string): _ItemClasses | null {
  const c = ready();
  if (c !== null) {
    const hit = c.items[opId];
    return hit === undefined ? null : hit;
  }
  const items = app.project.numItems;
  for (let i = 1; i <= items; i++) {
    const item = app.project.item(i);
    if (hasTag(item.comment, opId)) return item;
  }
  return null;
}

function scanComp(comp: CompItem, opId: string): Layer | null {
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    if (hasTag(layer.comment, opId)) return layer;
  }
  return null;
}

export function findLayerInComp(comp: CompItem, opId: string): Layer | null {
  const c = ready();
  if (c === null) return scanComp(comp, opId);
  const hit = c.layers[opId];
  if (hit === undefined) return null;
  // Bir xil iz boshqa comp'da (masalan shablon nusxasi) — shu comp'ni o'zi tekshiriladi.
  return (hit.containingComp as CompItem).id === comp.id ? hit : scanComp(comp, opId);
}

/** Layer'ni barcha comp'lardan qidiradi (havola faqat op_id bo'lganda). */
export function findLayerByOpId(opId: string): Layer | null {
  const c = ready();
  if (c !== null) {
    const hit = c.layers[opId];
    return hit === undefined ? null : hit;
  }
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem) {
      const layer = scanComp(item, opId);
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
