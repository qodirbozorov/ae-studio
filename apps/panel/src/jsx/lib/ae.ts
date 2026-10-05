/** AE object model yordamchilari (ES3). */
import type { OpResultData } from "@aes/shared/ae";
import { raise } from "./util";

export function findOrCreateFolder(name: string): FolderItem {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof FolderItem && item.name === name) return item;
  }
  return app.project.items.addFolder(name);
}

/** Layer vaqti: `start` dan boshlanadi; `dur` berilmasa comp oxirigacha. */
export function setLayerTiming(layer: Layer, comp: CompItem, start: number, dur?: number): void {
  layer.startTime = start;
  const end = dur === undefined ? comp.duration : start + dur;
  layer.outPoint = end > comp.duration ? comp.duration : end;
}

export function transformProperty(layer: Layer, matchName: string): Property {
  const group = layer.property("ADBE Transform Group") as PropertyGroup;
  return group.property(matchName) as Property;
}

export function layerResult(
  opId: string,
  layer: Layer,
  comp: CompItem,
  reused: boolean,
): OpResultData {
  return {
    op_id: opId,
    reused: reused,
    target: { kind: "layer", index: layer.index, comp_id: comp.id, name: layer.name },
  };
}

export function itemResult(
  opId: string,
  kind: "comp" | "footage" | "folder",
  item: _ItemClasses,
  reused: boolean,
): OpResultData {
  return { op_id: opId, reused: reused, target: { kind: kind, id: item.id, name: item.name } };
}

export function requireAvItem(item: _ItemClasses, ref: string): AVItem {
  if (!(item instanceof CompItem) && !(item instanceof FootageItem)) {
    return raise("AE_BAD_PARAMS", "Media elementi emas: " + ref);
  }
  return item;
}
