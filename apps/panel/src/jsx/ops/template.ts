/**
 * `template.instantiate` (§10.1, §11.2) — aep shablon:
 * 1) `template.aep` loyiha sifatida bir marta import qilinadi (`Templates` papkasiga, iz: `tpl.<slug>.v<n>`);
 * 2) shablon comp'i nusxalanadi (har sahna o'z nusxasini oladi), slotlar to'ldiriladi:
 *    matn → layer Source Text, media → placeholder layer manbasi (`fit` bilan), rang → Essential Graphics
 *    (yoki nusxadagi shu nomli "Color Control" effekti);
 * 3) nusxa sahna comp'iga layer bo'lib qo'yiladi; `time_remap` — shablon davomiyligi sahnaga moslanadi.
 */
import type { AeContext, OpResultData, TemplateInstantiateParams } from "@aes/shared/ae";
import {
  findOrCreateFolder,
  layerResult,
  requireAvItem,
  setLayerTiming,
  transformProperty,
} from "../lib/ae";
import { resolveInRoot } from "../lib/paths";
import {
  findItemByOpId,
  findLayerInComp,
  requireComp,
  requireItem,
  stampItem,
  stampLayer,
} from "../lib/trace";
import { hexToRgb, raise } from "../lib/util";
import { fitScale } from "./layer";

const TEMPLATES_FOLDER = "Templates";

function isInside(item: _ItemClasses, folder: FolderItem): boolean {
  let parent = item.parentFolder;
  // rootFolder'ning ota-papkasi o'zi bo'lishi mumkin — chuqurlik chegarasi bilan.
  for (let depth = 0; depth < 64 && parent !== null && parent !== undefined; depth++) {
    if (parent.id === folder.id) return true;
    if (parent === app.project.rootFolder) return false;
    parent = parent.parentFolder;
  }
  return false;
}

/** Shablon loyihasini (bir marta) import qiladi va uning ildiz papkasini qaytaradi. */
function importTemplate(p: TemplateInstantiateParams, ctx: AeContext): FolderItem {
  const tag = "tpl." + p.template + ".v" + p.version;
  const existing = findItemByOpId(tag);
  if (existing !== null && existing instanceof FolderItem) return existing;
  const file = new File(resolveInRoot(ctx.root, p.file));
  if (!file.exists) return raise("ASSET_MISSING", "Shablon fayli topilmadi: " + p.file);
  const options = new ImportOptions(file);
  options.importAs = ImportAsType.PROJECT;
  let imported: _ItemClasses;
  try {
    imported = app.project.importFile(options);
  } catch (error) {
    return raise(
      "AE_SCRIPT_ERROR",
      "Shablonni import qilib bo'lmadi: " + p.file + " — " + String(error),
    );
  }
  if (!(imported instanceof FolderItem)) {
    return raise("AE_SCRIPT_ERROR", "Shablon loyiha sifatida import qilinmadi: " + p.file);
  }
  imported.parentFolder = findOrCreateFolder(TEMPLATES_FOLDER);
  stampItem(imported, tag);
  return imported;
}

function findTemplateComp(folder: FolderItem, name: string): CompItem {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.name === name && isInside(item, folder)) return item;
  }
  return raise("AE_NOT_FOUND", "Shablonda comp topilmadi: " + name);
}

function requireNamedLayer(comp: CompItem, name: string): Layer {
  for (let i = 1; i <= comp.numLayers; i++) {
    const layer = comp.layer(i);
    if (layer.name === name) return layer;
  }
  return raise("AE_NOT_FOUND", "Shablon layer'i topilmadi: " + name);
}

/** Nusxadagi "Color Control" effekti (Essential Graphics bo'lmasa zaxira yo'li). */
function setColorControl(comp: CompItem, name: string, color: number[]): boolean {
  for (let i = 1; i <= comp.numLayers; i++) {
    const effects = comp.layer(i).property("ADBE Effect Parade") as PropertyGroup | null;
    if (effects === null) continue;
    for (let j = 1; j <= effects.numProperties; j++) {
      const effect = effects.property(j) as PropertyGroup;
      if (effect.name === name && effect.matchName === "ADBE Color Control") {
        (effect.property(1) as Property).setValue(color);
        return true;
      }
    }
  }
  return false;
}

function setEssentialColor(layer: Layer, name: string, color: number[]): boolean {
  try {
    const essential = (layer as AVLayer & { essentialProperty?: PropertyGroup }).essentialProperty;
    if (essential === undefined || essential === null) return false;
    (essential.property(name) as Property).setValue(color);
    return true;
  } catch (_error) {
    return false;
  }
}

export function templateInstantiate(
  p: TemplateInstantiateParams,
  opId: string,
  ctx: AeContext,
): OpResultData {
  const comp = requireComp(p.comp);
  const existing = findLayerInComp(comp, opId);
  if (existing !== null) return layerResult(opId, existing, comp, true);

  const folder = importTemplate(p, ctx);
  const source = findTemplateComp(folder, p.template_comp);
  // Nusxa: idempotent (resume'da avvalgi nusxa qayta ishlatiladi).
  let copy = findItemByOpId(opId + ".comp");
  if (copy === null || !(copy instanceof CompItem)) {
    copy = source.duplicate();
    copy.name = p.name === undefined ? source.name : p.name;
    copy.parentFolder = findOrCreateFolder(TEMPLATES_FOLDER);
    stampItem(copy, opId + ".comp");
  }
  const target = copy as CompItem;

  const colors: { egp: string; rgb: number[] }[] = [];
  for (let i = 0; i < p.slots.length; i++) {
    const slot = p.slots[i]!;
    if (slot.type === "text") {
      const layer = requireNamedLayer(target, slot.layer);
      const group = layer.property("ADBE Text Properties") as PropertyGroup | null;
      if (group === null) return raise("AE_BAD_PARAMS", "Matn layer emas: " + slot.layer);
      const prop = group.property("ADBE Text Document") as TextDocumentProperty;
      const doc = prop.value;
      doc.text = slot.text;
      prop.setValue(doc);
    } else if (slot.type === "media") {
      const layer = requireNamedLayer(target, slot.layer) as AVLayer;
      const item = requireAvItem(requireItem(slot.item), slot.item);
      layer.replaceSource(item, false);
      transformProperty(layer, "ADBE Scale").setValue(fitScale(slot.fit, item, target));
      transformProperty(layer, "ADBE Position").setValue([target.width / 2, target.height / 2]);
      if (item.hasAudio) layer.audioEnabled = false;
    } else {
      colors.push({ egp: slot.egp, rgb: hexToRgb(slot.color) });
    }
  }

  const layer = comp.layers.add(target);
  layer.name = p.name === undefined ? p.template : p.name;
  const dur = p.dur === undefined ? target.duration : p.dur;
  const fd = comp.frameDuration;
  if (p.stretch === "time_remap" && Math.abs(dur - target.duration) > fd / 2) {
    layer.startTime = p.start;
    layer.timeRemapEnabled = true;
    const remap = layer.property("ADBE Time Remapping") as Property;
    while (remap.numKeys > 0) remap.removeKey(remap.numKeys);
    remap.setValueAtTime(p.start, 0);
    remap.setValueAtTime(p.start + dur - fd, target.duration - fd);
    layer.outPoint = p.start + dur > comp.duration ? comp.duration : p.start + dur;
  } else {
    setLayerTiming(layer, comp, p.start, dur);
  }

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i]!;
    if (
      !setEssentialColor(layer, color.egp, color.rgb) &&
      !setColorControl(target, color.egp, color.rgb)
    ) {
      return raise(
        "AE_NOT_FOUND",
        "Rang xususiyati topilmadi (Essential Graphics / Color Control): " + color.egp,
      );
    }
  }
  stampLayer(layer, opId);
  return layerResult(opId, layer, comp, false);
}
