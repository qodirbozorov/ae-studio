/**
 * `AES.*` runtime (update-technicalguidline §3.2, §11-D): bundle bir marta yuklanadi va global `AES`
 * obyektini beradi. Sahna dasturlari (P6.04) va oplar shu funksiyalarni chaqiradi.
 * Tezlik qoidalari (§3.4): ko'p kalit `setValuesAtTimes` bilan, yozish siklida qiymat qayta o'qilmaydi.
 */
import { bezierEase, pathLength, rawEase, resolveCurve, valueDeltas } from "@aes/shared/easing";
import type { Curve, SegmentEase } from "@aes/shared/easing";
import { JSX_VERSION } from "../../shared/constants";
import { hexToRgb, isArray, raise } from "./util";

/** Kalit: `[t, v, curve?]` — curve oldingi kalitdan shu kalitgacha bo'lgan segmentga tegishli. */
export type AnimKey = [number, unknown, Curve?];

export interface AnimOptions {
  /** Spatial xususiyatda yo'l: `linear` (sukut, tangentlar 0) yoki `auto` (AE o'zi). */
  spatial?: "linear" | "auto";
}

function valueType(prop: Property): number {
  return prop.propertyValueType as unknown as number;
}

function isSpatial(prop: Property): boolean {
  const t = valueType(prop);
  return t === PropertyValueType.TwoD_SPATIAL || t === PropertyValueType.ThreeD_SPATIAL;
}

/** Temporal ease massivining uzunligi: spatial va rang — 1, TwoD — 2, ThreeD — 3. */
export function easeDims(prop: Property): number {
  const t = valueType(prop);
  if (t === PropertyValueType.TwoD) return 2;
  if (t === PropertyValueType.ThreeD) return 3;
  return 1;
}

/** Segment ease'i (§11-B): A→B uchun. Noto'g'ri curve — AE_BAD_PARAMS. */
export function segmentEase(
  prop: Property,
  curve: Curve,
  a: AnimKey,
  b: AnimKey,
): SegmentEase | "linear" | "hold" {
  const resolved = resolveCurve(curve);
  if (resolved === null) return raise("AE_BAD_PARAMS", "Noto'g'ri ease: " + String(curve));
  if (resolved.kind === "linear" || resolved.kind === "hold") return resolved.kind;
  const dims = easeDims(prop);
  if (resolved.kind === "raw") return rawEase(resolved.raw, dims);
  const t = valueType(prop);
  const color = t === PropertyValueType.COLOR;
  let deltas: number[];
  if (isSpatial(prop)) deltas = [pathLength(a[1], b[1])];
  else if (dims === 1) {
    const d = valueDeltas(a[1], b[1]);
    deltas = [d.length > 0 ? (d[0] as number) : 0];
  } else deltas = valueDeltas(a[1], b[1]);
  while (deltas.length < dims) deltas.push(0);
  return bezierEase(resolved.bezier, deltas, b[0] - a[0], color);
}

interface KeyPlan {
  inType: KeyframeInterpolationType;
  outType: KeyframeInterpolationType;
  inEase: KeyframeEase[] | null;
  outEase: KeyframeEase[] | null;
}

function toAe(values: { speed: number; influence: number }[]): KeyframeEase[] {
  const out: KeyframeEase[] = [];
  for (let i = 0; i < values.length; i++) {
    out.push(new KeyframeEase(values[i]!.speed, values[i]!.influence));
  }
  return out;
}

function flatEase(dims: number): KeyframeEase[] {
  const out: KeyframeEase[] = [];
  for (let i = 0; i < dims; i++) out.push(new KeyframeEase(0, 16.67));
  return out;
}

/** Spatial tangentlarni 0 qiladi (to'g'ri chiziqli yo'l). */
export function straightPath(prop: Property): void {
  if (!isSpatial(prop)) return;
  const zero = valueType(prop) === PropertyValueType.ThreeD_SPATIAL ? [0, 0, 0] : [0, 0];
  for (let i = 1; i <= prop.numKeys; i++) {
    prop.setSpatialTangentsAtKey(i, zero as never, zero as never);
  }
}

/**
 * Kalitlar va segment ease'lari. `curve` — kalitning o'z curve'i bo'lmasa ishlatiladi.
 * Avval hamma kalit yoziladi (`setValuesAtTimes`), so'ng har kalitga bir marta interpolatsiya/ease.
 */
export function anim(prop: Property, keys: AnimKey[], curve: Curve, options?: AnimOptions): number {
  if (!isArray(keys) || keys.length === 0) return raise("AE_BAD_PARAMS", "anim: kalitlar yo'q");
  const times: number[] = [];
  const values: unknown[] = [];
  for (let i = 0; i < keys.length; i++) {
    times.push(keys[i]![0]);
    values.push(keys[i]![1]);
  }
  const bulk = (prop as unknown as { setValuesAtTimes?: unknown }).setValuesAtTimes;
  if (keys.length > 1 && typeof bulk === "function") {
    prop.setValuesAtTimes(times, values as never);
  } else {
    for (let i = 0; i < keys.length; i++) prop.setValueAtTime(times[i]!, values[i] as never);
  }
  const indices: number[] = [];
  for (let i = 0; i < keys.length; i++) indices.push(prop.nearestKeyIndex(times[i]!));

  const dims = easeDims(prop);
  const plans: KeyPlan[] = [];
  for (let i = 0; i < keys.length; i++) {
    plans.push({
      inType: KeyframeInterpolationType.LINEAR,
      outType: KeyframeInterpolationType.LINEAR,
      inEase: null,
      outEase: null,
    });
  }
  for (let i = 1; i < keys.length; i++) {
    const own = keys[i]![2];
    const segment = segmentEase(
      prop,
      own === undefined || own === null ? curve : own,
      keys[i - 1]!,
      keys[i]!,
    );
    const a = plans[i - 1]!;
    const b = plans[i]!;
    if (segment === "hold") {
      a.outType = KeyframeInterpolationType.HOLD;
    } else if (segment !== "linear") {
      a.outType = KeyframeInterpolationType.BEZIER;
      b.inType = KeyframeInterpolationType.BEZIER;
      a.outEase = toAe(segment.out);
      b.inEase = toAe(segment.in);
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const plan = plans[i]!;
    const index = indices[i]!;
    prop.setInterpolationTypeAtKey(index, plan.inType, plan.outType);
    if (plan.inEase !== null || plan.outEase !== null) {
      // types-for-adobe kortej talab qiladi; uzunlik `easeDims` bilan to'g'ri.
      prop.setTemporalEaseAtKey(
        index,
        (plan.inEase ?? flatEase(dims)) as unknown as [KeyframeEase],
        (plan.outEase ?? flatEase(dims)) as unknown as [KeyframeEase],
      );
    }
  }
  if (options === undefined || options.spatial !== "auto") straightPath(prop);
  return keys.length;
}

export function findComp(name: string): CompItem | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const item = app.project.item(i);
    if (item instanceof CompItem && item.name === name) return item;
  }
  return null;
}

/** Nomi bo'yicha comp: bor bo'lsa o'sha, yo'q bo'lsa yaratiladi. */
/** Nomi bo'yicha comp: bor bo'lsa o'sha; o'lcham berilsa yaratiladi, aks holda AE_NOT_FOUND. */
export function comp(name: string, w?: number, h?: number, dur?: number, fps?: number): CompItem {
  const found = findComp(name);
  if (found !== null) return found;
  if (w === undefined || h === undefined || dur === undefined || fps === undefined) {
    return raise("AE_NOT_FOUND", "Comp topilmadi: " + name);
  }
  return app.project.items.addComp(name, w, h, 1, dur, fps);
}

export interface DumpNode {
  name: string;
  match_name: string;
  index: number;
  value?: unknown;
  keys?: number;
  expression?: string;
  children?: DumpNode[];
  /** Tugunlar chegarasiga yetildi — qolgani ko'rsatilmadi. */
  truncated?: boolean;
}

/**
 * JSON'ga xavfsiz qiymat: son, satr, boolean, sonlar massivi; TextDocument → matn; Shape → qisqa tavsif.
 * AE host obyektlari (MarkerValue va h.k.) seriyalanmaydi — json2 ularni sanab AE'ni qotirishi mumkin.
 */
export function plainValue(value: unknown): unknown {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (isArray(value)) {
    for (let i = 0; i < value.length; i++) if (typeof value[i] !== "number") return undefined;
    return value;
  }
  if (typeof value === "object" && value !== null) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string") return text;
    const vertices = (value as { vertices?: unknown }).vertices;
    if (isArray(vertices)) {
      return { vertices: vertices.length, closed: (value as { closed?: unknown }).closed === true };
    }
  }
  return undefined;
}

/** `dump` tugunlari chegarasi (katta qatlamda javob va vaqt cheklangan bo'lsin). */
const DUMP_MAX_NODES = 1500;

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (_e) {
    return fallback;
  }
}

/** Property daraxti (matchName'larni aniqlash uchun, §11-C "dump"). */
export function dump(prop: PropertyBase, depth?: number, budget?: { left: number }): DumpNode {
  const limit = depth === undefined ? 3 : depth;
  const left = budget === undefined ? { left: DUMP_MAX_NODES } : budget;
  left.left--;
  const node: DumpNode = {
    name: safe(() => prop.name, ""),
    match_name: safe(() => prop.matchName, ""),
    index: safe(() => prop.propertyIndex, 0),
  };
  const count = safe(() => (prop as PropertyGroup).numProperties, 0);
  if (typeof count === "number" && count > 0) {
    if (limit > 0) {
      node.children = [];
      for (let i = 1; i <= count; i++) {
        if (left.left <= 0) {
          node.truncated = true;
          break;
        }
        const child = safe<PropertyBase | null>(() => (prop as PropertyGroup).property(i), null);
        if (child !== null) node.children.push(dump(child, limit - 1, left));
      }
    }
    return node;
  }
  const leaf = prop as Property;
  const value = plainValue(safe<unknown>(() => leaf.value, undefined));
  if (value !== undefined) node.value = value;
  const keys = safe(() => leaf.numKeys, 0);
  if (typeof keys === "number" && keys > 0) node.keys = keys;
  const expression = safe(() => leaf.expression, "");
  if (typeof expression === "string" && expression !== "") node.expression = expression;
  return node;
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

function pad3(n: number): string {
  const s = String(n);
  return s.length >= 3 ? s : s.length === 2 ? "0" + s : "00" + s;
}

/** `<root>/<base>_vNNN.aep` — birinchi bo'sh versiyaga saqlaydi (ustiga yozilmaydi). */
export function saveVersion(root: string, base: string): string {
  const dir = root.replace(/[\\\x2f]+$/, "");
  let n = 1;
  let target = new File(dir + "/" + base + "_v" + pad3(n) + ".aep");
  while (target.exists && n < 999) {
    n++;
    target = new File(dir + "/" + base + "_v" + pad3(n) + ".aep");
  }
  if (target.exists) return raise("AE_BAD_PARAMS", "Bo'sh versiya qolmadi: " + base);
  app.project.save(target);
  return target.fsName;
}

export const AES = {
  version: JSX_VERSION,
  hex: hexToRgb,
  findComp: findComp,
  comp: comp,
  anim: anim,
  segmentEase: segmentEase,
  straightPath: straightPath,
  dump: dump,
  json: json,
  saveVersion: saveVersion,
};
