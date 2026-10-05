import type { CompCreateParams, CompNestParams, OpResultData } from "@aes/shared/ae";
import { findOrCreateFolder, itemResult, layerResult, setLayerTiming } from "../lib/ae";
import { findItemByOpId, findLayerInComp, requireComp, stampItem, stampLayer } from "../lib/trace";
import { hexToRgb, raise } from "../lib/util";

/** `comp.create` — izi bor bo'lsa mavjud comp qaytariladi (dublikat yo'q). */
export function compCreate(p: CompCreateParams, opId: string): OpResultData {
  const existing = findItemByOpId(opId);
  if (existing !== null) {
    if (!(existing instanceof CompItem)) {
      return raise("AE_SCRIPT_ERROR", "op_id boshqa turdagi elementda: " + opId);
    }
    return itemResult(opId, "comp", existing, true);
  }
  const comp = app.project.items.addComp(p.name, p.w, p.h, 1, p.dur, p.fps);
  if (p.bg !== undefined) comp.bgColor = hexToRgb(p.bg);
  if (p.folder !== undefined) comp.parentFolder = findOrCreateFolder(p.folder);
  stampItem(comp, opId);
  return itemResult(opId, "comp", comp, false);
}

/** `comp.nest` — sahna comp'ini asosiy comp ichiga layer sifatida qo'yadi. */
export function compNest(p: CompNestParams, opId: string): OpResultData {
  const parent = requireComp(p.parent);
  const existing = findLayerInComp(parent, opId);
  if (existing !== null) return layerResult(opId, existing, parent, true);
  const child = requireComp(p.child);
  if (child.id === parent.id) return raise("AE_BAD_PARAMS", "Comp o'zini o'ziga nest qila olmaydi");
  const layer = parent.layers.add(child);
  if (p.name !== undefined) layer.name = p.name;
  setLayerTiming(layer, parent, p.start, p.dur === undefined ? child.duration : p.dur);
  stampLayer(layer, opId);
  return layerResult(opId, layer, parent, false);
}
