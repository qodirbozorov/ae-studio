/**
 * Gibrid skriptlar uchun AES yordamchilari (prelude): qatlam topish, preset (.ffx) qidirish va qo'llash,
 * xususiyat yo'li. `jsx.run` snippetlari `AES.target(args)`, `AES.preset(...)`, `AES.prop(...)` ni chaqiradi.
 */
import { resolvePath } from "./props";
import { findComp } from "./runtime";
import { requireLayer } from "./trace";
import { raise } from "./util";

/** Joriy ish papkasi (`jsx.run` har chaqiruvda yozadi): loyiha `presets/` papkasi uchun. */
export const state = { root: "" };

export function findLayer(compName: string, id: string): Layer {
  const comp = findComp(compName);
  if (comp === null) return raise("AE_NOT_FOUND", "Comp topilmadi: " + compName);
  for (let i = 1; i <= comp.numLayers; i++) {
    if (comp.layer(i).name === id) return comp.layer(i);
  }
  return raise("AE_NOT_FOUND", "Qatlam topilmadi: " + compName + " → " + id);
}

/** Snippet qatlami: `__ref` (kompilyator op ref'i) yoki comp + `layer` nomi. */
export function target(args: { [key: string]: unknown }): Layer {
  if (typeof args.__ref === "string") return requireLayer(args.__ref);
  const compName = typeof args.__comp === "string" ? args.__comp : args.comp;
  if (typeof compName !== "string" || typeof args.layer !== "string") {
    return raise("AE_BAD_PARAMS", "args.comp va args.layer kerak");
  }
  return findLayer(compName, args.layer);
}

export function selectOnly(layer: Layer): void {
  const comp = layer.containingComp;
  for (let i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
  layer.selected = true;
}

function presetDirs(): Folder[] {
  const dirs: Folder[] = [];
  if (state.root !== "") dirs.push(new Folder(state.root + "/presets"));
  try {
    const adobe = new Folder(Folder.myDocuments.fsName + "/Adobe");
    if (adobe.exists) {
      const versions = adobe.getFiles("After Effects*");
      for (let i = 0; i < versions.length; i++) {
        const dir = versions[i];
        if (dir instanceof Folder) dirs.push(new Folder(dir.fsName + "/User Presets"));
      }
    }
  } catch (_e) {
    // Hujjatlar papkasi yo'q yoki o'qilmadi.
  }
  try {
    if (Folder.appPackage) dirs.push(new Folder(Folder.appPackage.fsName + "/Presets"));
  } catch (_e) {
    // AE papkasi aniqlanmadi.
  }
  return dirs;
}

/** Barcha .ffx fayllar (chuqurlik 5 gacha). */
export function listPresets(limit: number): File[] {
  const out: File[] = [];
  const walk = (folder: Folder, depth: number) => {
    if (!folder.exists || depth > 5 || out.length >= limit) return;
    let items: (File | Folder)[];
    try {
      items = folder.getFiles();
    } catch (_e) {
      return;
    }
    for (let i = 0; i < items.length && out.length < limit; i++) {
      const item = items[i];
      if (item instanceof Folder) walk(item, depth + 1);
      else if (item instanceof File && /\.ffx$/i.test(item.name)) out.push(item);
    }
  };
  const dirs = presetDirs();
  for (let i = 0; i < dirs.length; i++) walk(dirs[i] as Folder, 0);
  return out;
}

export function presetName(file: File): string {
  return decodeURI(file.name).replace(/\.ffx$/i, "");
}

/** Nomi bo'yicha preset (katta-kichik harfsiz; `.ffx` ixtiyoriy). */
export function findPreset(name: string): File | null {
  const wanted = name.replace(/\.ffx$/i, "").toLowerCase();
  const all = listPresets(20000);
  for (let i = 0; i < all.length; i++) {
    if (presetName(all[i] as File).toLowerCase() === wanted) return all[i] as File;
  }
  return null;
}

/** Presetni qatlamga `sec` (comp vaqti) da qo'llaydi; topilmasa xato ("Preset topilmadi"). */
export function preset(layer: Layer, name: string, sec: number): void {
  const file = findPreset(name);
  if (file === null) raise("AE_NOT_FOUND", "Preset topilmadi: " + name);
  selectOnly(layer);
  layer.containingComp.time = sec;
  (layer as AVLayer).applyPreset(file as File);
}

export const hybrid = {
  target: target,
  layer: findLayer,
  selectOnly: selectOnly,
  preset: preset,
  findPreset: findPreset,
  prop: resolvePath,
  at: (comp: CompItem, sec: number) => {
    comp.time = sec;
  },
};
