/** `layer.inspect` — qurilgan comp yoki qatlam tuzilmasi (Claude natijani tekshirishi uchun, §5.2). */
import type { LayerInspectParams, OpResultData } from "@aes/shared/ae";
import { dump, findComp } from "../lib/runtime";
import { requireLayer } from "../lib/trace";
import { raise } from "../lib/util";

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (_e) {
    return fallback;
  }
}

function has(layer: Layer, matchName: string): boolean {
  return safe(() => layer.property(matchName) !== null, false);
}

function layerType(layer: Layer): string {
  if (has(layer, "ADBE Text Properties")) return "text";
  if (has(layer, "ADBE Root Vectors Group")) return "shape";
  const av = layer as AVLayer;
  if (safe(() => av.nullLayer, false)) return "null";
  if (safe(() => av.adjustmentLayer, false)) return "adjustment";
  const source = safe<unknown>(() => av.source, null);
  if (source instanceof CompItem) return "precomp";
  return source === null ? "other" : "footage";
}

function names(group: PropertyGroup | null): string[] {
  const out: string[] = [];
  if (group === null) return out;
  for (let i = 1; i <= group.numProperties; i++) out.push(group.property(i).name);
  return out;
}

function summary(layer: Layer): { [key: string]: unknown } {
  const av = layer as AVLayer;
  const parent = safe<Layer | null>(() => layer.parent, null);
  return {
    index: layer.index,
    name: layer.name,
    type: layerType(layer),
    in: layer.inPoint,
    out: layer.outPoint,
    enabled: layer.enabled,
    three_d: safe(() => av.threeDLayer, false),
    parent: parent === null ? null : parent.name,
    effects: names(
      safe<PropertyGroup | null>(() => layer.property("ADBE Effect Parade") as PropertyGroup, null),
    ),
    masks: names(
      safe<PropertyGroup | null>(() => layer.property("ADBE Mask Parade") as PropertyGroup, null),
    ),
  };
}

export function layerInspect(p: LayerInspectParams, opId: string): OpResultData {
  let layer: Layer | null = null;
  if (p.ref !== undefined) layer = requireLayer(p.ref);
  let comp: CompItem | null = null;
  if (layer === null) {
    const active = app.project.activeItem;
    if (p.comp !== undefined) comp = findComp(p.comp);
    else if (active instanceof CompItem) comp = active;
    if (comp === null)
      return raise("AE_NOT_FOUND", "Comp topilmadi: " + (p.comp ?? "(faol comp yo'q)"));
    if (p.layer !== undefined) {
      for (let i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === p.layer) {
          layer = comp.layer(i);
          break;
        }
      }
      if (layer === null) return raise("AE_NOT_FOUND", "Qatlam topilmadi: " + p.layer);
    }
  }
  if (layer !== null) {
    const info = summary(layer);
    info.tree = dump(layer, p.depth === undefined ? 3 : p.depth);
    return { op_id: opId, reused: false, info: { layer: info } };
  }
  const target = comp as CompItem;
  const layers: { [key: string]: unknown }[] = [];
  for (let i = 1; i <= target.numLayers; i++) layers.push(summary(target.layer(i)));
  return {
    op_id: opId,
    reused: false,
    info: {
      comp: {
        name: target.name,
        w: target.width,
        h: target.height,
        duration: target.duration,
        fps: target.frameRate,
        layers: layers,
      },
    },
  };
}
