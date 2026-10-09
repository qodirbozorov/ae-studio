/**
 * Xususiyat yo'llari → AE Property (prop.keyframes, Faza 7). Yo'llar:
 * - qatlam: `position`, `position.x|y|z`, `anchor`, `scale`, `rotation`, `opacity`, `rotation_x|y`, `orientation`;
 * - shape: `contents.<id>.<prop>` (vector group nomi = id);
 * - effekt: `effects.<id>.<param>` (param: 1-indeks, matchName yoki nom);
 * - maska: `masks.<id>.feather|expansion|opacity|path`;
 * - eski: `ADBE Transform Group/ADBE Position` (matchName yo'li, raqam — 1-indeks).
 */
import { hexToRgb, isArray, raise } from "./util";

const LAYER_ALIASES: { [alias: string]: string[] | undefined } = {
  position: ["ADBE Transform Group", "ADBE Position"],
  scale: ["ADBE Transform Group", "ADBE Scale"],
  rotation: ["ADBE Transform Group", "ADBE Rotate Z"],
  opacity: ["ADBE Transform Group", "ADBE Opacity"],
  anchor_point: ["ADBE Transform Group", "ADBE Anchor Point"],
  anchor: ["ADBE Transform Group", "ADBE Anchor Point"],
  rotation_x: ["ADBE Transform Group", "ADBE Rotate X"],
  rotation_y: ["ADBE Transform Group", "ADBE Rotate Y"],
  orientation: ["ADBE Transform Group", "ADBE Orientation"],
};

const SEPARATED: { [alias: string]: string | undefined } = {
  "position.x": "ADBE Position_0",
  "position.y": "ADBE Position_1",
  "position.z": "ADBE Position_2",
};

/** Vector group ichidagi element (birinchi mosi) va uning xususiyati. "T" — guruh transformi. */
const CONTENT_PROPS: { [sub: string]: string[][] | undefined } = {
  size: [
    ["ADBE Vector Shape - Rect", "ADBE Vector Rect Size"],
    ["ADBE Vector Shape - Ellipse", "ADBE Vector Ellipse Size"],
  ],
  position: [
    ["ADBE Vector Shape - Rect", "ADBE Vector Rect Position"],
    ["ADBE Vector Shape - Ellipse", "ADBE Vector Ellipse Position"],
    ["ADBE Vector Shape - Star", "ADBE Vector Star Position"],
  ],
  roundness: [["ADBE Vector Shape - Rect", "ADBE Vector Rect Roundness"]],
  points: [["ADBE Vector Shape - Star", "ADBE Vector Star Points"]],
  outer_radius: [["ADBE Vector Shape - Star", "ADBE Vector Star Outer Radius"]],
  inner_radius: [["ADBE Vector Shape - Star", "ADBE Vector Star Inner Radius"]],
  outer_roundness: [["ADBE Vector Shape - Star", "ADBE Vector Star Outer Roundess"]],
  inner_roundness: [["ADBE Vector Shape - Star", "ADBE Vector Star Inner Roundess"]],
  rotation: [["ADBE Vector Shape - Star", "ADBE Vector Star Rotation"]],
  "fill.color": [["ADBE Vector Graphic - Fill", "ADBE Vector Fill Color"]],
  "fill.opacity": [
    ["ADBE Vector Graphic - Fill", "ADBE Vector Fill Opacity"],
    ["ADBE Vector Graphic - G-Fill", "ADBE Vector Fill Opacity"],
  ],
  "stroke.color": [["ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Color"]],
  "stroke.width": [
    ["ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Width"],
    ["ADBE Vector Graphic - G-Stroke", "ADBE Vector Stroke Width"],
  ],
  "stroke.opacity": [
    ["ADBE Vector Graphic - Stroke", "ADBE Vector Stroke Opacity"],
    ["ADBE Vector Graphic - G-Stroke", "ADBE Vector Stroke Opacity"],
  ],
  "trim.start": [["ADBE Vector Filter - Trim", "ADBE Vector Trim Start"]],
  "trim.end": [["ADBE Vector Filter - Trim", "ADBE Vector Trim End"]],
  "trim.offset": [["ADBE Vector Filter - Trim", "ADBE Vector Trim Offset"]],
  round_corners: [["ADBE Vector Filter - RC", "ADBE Vector RoundCorner Radius"]],
  "offset_paths.amount": [["ADBE Vector Filter - Offset", "ADBE Vector Offset Amount"]],
  pucker_bloat: [["ADBE Vector Filter - PB", "1"]],
  "twist.angle": [["ADBE Vector Filter - Twist", "1"]],
  "zig_zag.size": [["ADBE Vector Filter - Zigzag", "1"]],
  "wiggle.size": [["ADBE Vector Filter - Roughen", "1"]],
  "repeater.copies": [["ADBE Vector Filter - Repeater", "ADBE Vector Repeater Copies"]],
  "repeater.offset": [["ADBE Vector Filter - Repeater", "ADBE Vector Repeater Offset"]],
  "repeater.position": [["ADBE Vector Filter - Repeater", "R", "ADBE Vector Repeater Position"]],
  "repeater.scale": [["ADBE Vector Filter - Repeater", "R", "ADBE Vector Repeater Scale"]],
  "repeater.rotation": [["ADBE Vector Filter - Repeater", "R", "ADBE Vector Repeater Rotation"]],
  "transform.anchor": [["T", "ADBE Vector Anchor"]],
  "transform.position": [["T", "ADBE Vector Position"]],
  "transform.scale": [["T", "ADBE Vector Scale"]],
  "transform.rotation": [["T", "ADBE Vector Rotation"]],
  "transform.opacity": [["T", "ADBE Vector Group Opacity"]],
  "transform.skew": [["T", "ADBE Vector Skew"]],
  "transform.skew_axis": [["T", "ADBE Vector Skew Axis"]],
};

const MASK_PROPS: { [name: string]: string | undefined } = {
  feather: "ADBE Mask Feather",
  expansion: "ADBE Mask Offset",
  opacity: "ADBE Mask Opacity",
  path: "ADBE Mask Shape",
};

function child(group: PropertyGroup, key: string): PropertyBase | null {
  try {
    const found = /^\d+$/.test(key) ? group.property(parseInt(key, 10)) : group.property(key);
    return found === undefined ? null : found;
  } catch (_e) {
    return null;
  }
}

/** Nomi `id` bo'lgan vector group (ichma-ich qidiruv). */
export function findContentGroup(parent: PropertyGroup, id: string): PropertyGroup | null {
  for (let i = 1; i <= parent.numProperties; i++) {
    const item = parent.property(i) as PropertyGroup;
    if (item.matchName !== "ADBE Vector Group") continue;
    if (item.name === id) return item;
    const inner = findContentGroup(item.property("ADBE Vectors Group") as PropertyGroup, id);
    if (inner !== null) return inner;
  }
  return null;
}

function contentProperty(layer: Layer, id: string, sub: string, path: string): Property {
  const root = child(layer, "ADBE Root Vectors Group") as PropertyGroup | null;
  if (root === null) return raise("AE_BAD_PARAMS", "Shape qatlami emas: " + path);
  const group = findContentGroup(root, id);
  if (group === null) return raise("AE_NOT_FOUND", "Shape contents topilmadi: " + id);
  const candidates = CONTENT_PROPS[sub];
  if (candidates === undefined)
    return raise("AE_BAD_PARAMS", "Noma'lum contents xususiyati: " + sub);
  const vectors = group.property("ADBE Vectors Group") as PropertyGroup;
  for (let c = 0; c < candidates.length; c++) {
    const chain = candidates[c]!;
    let current: PropertyGroup | null;
    if (chain[0] === "T") current = group.property("ADBE Vector Transform Group") as PropertyGroup;
    else {
      current = null;
      for (let i = 1; i <= vectors.numProperties; i++) {
        const item = vectors.property(i) as PropertyGroup;
        if (item.matchName === chain[0]) {
          current = item;
          break;
        }
      }
    }
    if (current === null) continue;
    for (let s = 1; s < chain.length; s++) {
      const key = chain[s] === "R" ? "ADBE Vector Repeater Transform" : (chain[s] as string);
      const next = child(current, key);
      if (next === null) return raise("AE_NOT_FOUND", "Property topilmadi: " + path);
      current = next as PropertyGroup;
    }
    return current as unknown as Property;
  }
  return raise("AE_NOT_FOUND", "Contents'da bu xususiyat yo'q: " + path);
}

/** Effekt parametri: 1-indeks, matchName, ko'rinadigan nom (katta-kichik harfsiz). */
export function effectParam(effect: PropertyGroup, key: string): Property | null {
  if (/^\d+$/.test(key)) {
    const index = parseInt(key, 10);
    return index >= 1 && index <= effect.numProperties
      ? (effect.property(index) as Property)
      : null;
  }
  const direct = child(effect, key);
  if (direct !== null) return direct as Property;
  const lower = key.toLowerCase();
  for (let i = 1; i <= effect.numProperties; i++) {
    const prop = effect.property(i);
    if (prop.name.toLowerCase() === lower || prop.matchName.toLowerCase() === lower) {
      return prop as Property;
    }
  }
  return null;
}

/** Effekt parametrlari nomlari (xato xabarlari uchun). */
export function paramNames(effect: PropertyGroup): string[] {
  const out: string[] = [];
  for (let i = 1; i <= effect.numProperties && out.length < 40; i++) {
    out.push(i + ": " + effect.property(i).name);
  }
  return out;
}

export function resolvePath(layer: Layer, path: string): Property {
  const alias = LAYER_ALIASES[path];
  const separated = SEPARATED[path];
  if (separated !== undefined) {
    const group = layer.property("ADBE Transform Group") as PropertyGroup;
    const position = group.property("ADBE Position") as Property;
    if (!position.dimensionsSeparated) position.dimensionsSeparated = true;
    const prop = child(group, separated);
    if (prop === null) return raise("AE_NOT_FOUND", "Property topilmadi: " + path);
    return prop as Property;
  }
  const dot = path.indexOf(".");
  const head = dot < 0 ? path : path.substring(0, dot);
  if (
    alias === undefined &&
    dot > 0 &&
    (head === "contents" || head === "effects" || head === "masks")
  ) {
    const rest = path.substring(dot + 1);
    const next = rest.indexOf(".");
    if (next <= 0) return raise("AE_BAD_PARAMS", "Yo'l to'liq emas: " + path);
    const id = rest.substring(0, next);
    const sub = rest.substring(next + 1);
    if (head === "contents") return contentProperty(layer, id, sub, path);
    if (head === "effects") {
      const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
      const effect = child(parade, id) as PropertyGroup | null;
      if (effect === null) return raise("AE_NOT_FOUND", "Effekt topilmadi: " + id);
      const param = effectParam(effect, sub);
      if (param === null) {
        return raise("FX_PARAM_UNKNOWN", "Effekt parametri topilmadi: " + id + " → " + sub, {
          params: paramNames(effect),
        });
      }
      return param;
    }
    const masks = layer.property("ADBE Mask Parade") as PropertyGroup;
    const mask = child(masks, id) as PropertyGroup | null;
    if (mask === null) return raise("AE_NOT_FOUND", "Maska topilmadi: " + id);
    const matchName = MASK_PROPS[sub];
    if (matchName === undefined) return raise("AE_BAD_PARAMS", "Noma'lum maska xususiyati: " + sub);
    return mask.property(matchName) as Property;
  }
  const segments = alias ?? path.split("/");
  let current: PropertyBase = layer;
  for (let i = 0; i < segments.length; i++) {
    const next = child(current as PropertyGroup, segments[i] as string);
    if (next === null) {
      return raise("AE_NOT_FOUND", "Property topilmadi: " + path + " (" + segments[i] + ")");
    }
    current = next;
  }
  return current as Property;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Spec qiymati → AE: `#RRGGBB` → [r, g, b, 1], boolean → 1/0. */
export function toAeValue(value: unknown): unknown {
  if (typeof value === "string" && HEX.test(value)) {
    const rgb = hexToRgb(value);
    return [rgb[0], rgb[1], rgb[2], 1];
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (isArray(value)) return value;
  return value;
}
