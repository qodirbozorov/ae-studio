/**
 * Gibrid skript oplari: `jsx.run` (snippet yoki xom kod AES prelude bilan; xato job'ni to'xtatmaydi —
 * natija `info.ok` / `info.error` / `info.line` bilan log'ga), `presets.list`, `preset.inspect`.
 */
import type {
  AeContext,
  JsxRunParams,
  OpResultData,
  PresetInspectParams,
  PresetsListParams,
} from "@aes/shared/ae";
import { findOrCreateFolder } from "../lib/ae";
import { findPreset, hybrid, listPresets, presetName, state } from "../lib/hybrid";
import { AES, dump } from "../lib/runtime";
import type { DumpNode } from "../lib/runtime";
import { findItemByOpId, stampItem } from "../lib/trace";
import { isArray, isAesThrown, raise } from "../lib/util";

/** Bajarilgan build skriptlari izi (resume'da qayta qo'llanmaydi). */
const DONE_FOLDER = "AES Scripts";

function now(): number {
  return new Date().getTime();
}

/** Natija: primitivlar, oddiy obyekt/massiv (AE host obyektlari emas). */
function plain(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "number" || t === "string" || t === "boolean") return value;
  if (depth > 4) return null;
  if (isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length && i < 200; i++) out.push(plain(value[i], depth + 1));
    return out;
  }
  if (t === "object" && (value as object).constructor === Object) {
    const out: { [key: string]: unknown } = {};
    const obj = value as { [key: string]: unknown };
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = plain(obj[key], depth + 1);
    }
    return out;
  }
  return String(value);
}

/** To'g'ridan-to'g'ri eval (global `AES` ko'rinadi): oxirgi ifoda qiymatini qaytaradi. */
function evalCode(code: string): unknown {
  return eval(code);
}

export function jsxRun(p: JsxRunParams, opId: string, ctx: AeContext): OpResultData {
  if (p.once === true && findItemByOpId(opId) !== null) {
    return { op_id: opId, reused: true, info: { ok: true, skipped: true } };
  }
  state.root = ctx.root;
  const started = now();
  const prelude = AES as unknown as { [key: string]: unknown };
  for (const key in hybrid) {
    if (Object.prototype.hasOwnProperty.call(hybrid, key)) {
      prelude[key] = (hybrid as unknown as { [key: string]: unknown })[key];
    }
  }
  let info: { [key: string]: unknown };
  try {
    const args = p.args === undefined ? {} : p.args;
    prelude.args = args;
    let value: unknown;
    let asBody = false;
    // Avval eval: skriptning oxirgi ifodasi (masalan `(function(){ ... return log; })()`) natija bo'ladi.
    // Yuqori darajadagi `return` (snippetlar) SyntaxError beradi — unda funksiya tanasi sifatida.
    try {
      value = evalCode(p.code);
    } catch (error) {
      if ((error as { name?: unknown }).name !== "SyntaxError") throw error;
      asBody = true;
    }
    if (asBody) {
      const Make = Function as unknown as new (
        ...parts: string[]
      ) => (aes: unknown, args: unknown, ctx: unknown) => unknown;
      value = new Make("AES", "args", "ctx", p.code)(AES, args, { root: ctx.root });
    }
    info = { ok: true, result: plain(value, 0), ms: now() - started };
  } catch (error) {
    const e = error as { message?: unknown; line?: unknown };
    info = {
      ok: false,
      error: isAesThrown(error)
        ? error.message
        : typeof e.message === "string"
          ? e.message
          : String(error),
      line: typeof e.line === "number" ? e.line : null,
      ms: now() - started,
    };
  }
  if (p.label !== undefined) info.label = p.label;
  if (p.once === true && info.ok === true) stampItem(findOrCreateFolder(DONE_FOLDER), opId);
  return { op_id: opId, reused: false, info: info };
}

export function presetsList(p: PresetsListParams, opId: string, ctx: AeContext): OpResultData {
  state.root = ctx.root;
  const query = p.query === undefined ? "" : p.query.toLowerCase();
  const limit = p.limit === undefined ? 200 : p.limit;
  const all = listPresets(20000);
  const presets: { name: string; path: string }[] = [];
  let total = 0;
  for (let i = 0; i < all.length; i++) {
    const file = all[i] as File;
    const name = presetName(file);
    if (query !== "" && name.toLowerCase().indexOf(query) < 0) continue;
    total++;
    if (presets.length < limit) presets.push({ name: name, path: file.fsName });
  }
  return { op_id: opId, reused: false, info: { presets: presets, total: total } };
}

function collect(node: DumpNode, path: string, out: { [key: string]: unknown }[]): void {
  const here = path === "" ? node.name : path + "/" + node.name;
  if (node.keys !== undefined || node.expression !== undefined) {
    const entry: { [key: string]: unknown } = { path: here, match_name: node.match_name };
    if (node.keys !== undefined) entry.keys = node.keys;
    if (node.expression !== undefined) entry.expression = node.expression;
    out.push(entry);
  }
  const children = node.children === undefined ? [] : node.children;
  for (let i = 0; i < children.length; i++) collect(children[i]!, here, out);
}

/** Presetni vaqtinchalik qatlamga qo'llab, nima qo'shganini qaytaradi (effektlar, keyframe, expression). */
export function presetInspect(p: PresetInspectParams, opId: string, ctx: AeContext): OpResultData {
  state.root = ctx.root;
  const file = findPreset(p.name);
  if (file === null) return raise("AE_NOT_FOUND", "Preset topilmadi: " + p.name);
  const comp = app.project.items.addComp("aes_preset_probe", 1080, 1080, 1, 10, 30);
  let solid: _ItemClasses | null = null;
  try {
    let layer: Layer;
    if (p.layer_type === "solid") {
      layer = comp.layers.addSolid([0.5, 0.5, 0.5], "probe", 1080, 1080, 1);
      solid = (layer as AVLayer).source;
    } else if (p.layer_type === "shape") {
      layer = comp.layers.addShape();
    } else {
      layer = comp.layers.addText("Tezroq.");
    }
    (layer as AVLayer).applyPreset(file);
    const effects: string[] = [];
    const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
    for (let i = 1; i <= parade.numProperties; i++) {
      effects.push(parade.property(i).name + " (" + parade.property(i).matchName + ")");
    }
    const animated: { [key: string]: unknown }[] = [];
    collect(dump(layer, 6), "", animated);
    return {
      op_id: opId,
      reused: false,
      info: { preset: presetName(file), path: file.fsName, effects: effects, animated: animated },
    };
  } finally {
    comp.remove();
    if (solid !== null) solid.remove();
  }
}
