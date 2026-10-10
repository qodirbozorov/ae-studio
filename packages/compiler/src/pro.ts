/**
 * Professional qatlam maydonlari → oplar (Faza 7): `layer.set`, `fx.add`, `layer.mask`, `prop.keyframes`
 * va shape contents (`layer.add_shape.contents`). Qiymatlar AE birliklarida o'zgarishsiz uzatiladi.
 */
import { fail, ok } from "@aes/shared";
import type {
  AeOpName,
  HexColor,
  Keyframe,
  Layer,
  LayerTransformOp,
  MaskSpec,
  OpParamsMap,
  ProKey,
  Result,
  ShapeContentOp,
  ShapeContentSpec,
  ShapePathOp,
  Vec2,
} from "@aes/shared";
import { fxMatchName, fxParamKey, mapFxParam } from "./effects";
import { round } from "./layout";
import { SCRIPT_LIB, expandExpression } from "./scripts";
import { ellipsePath, fitPaths, parseSvgPath, pointsPath, rectPath } from "./svg";

export type AddOp = <N extends AeOpName>(op: N, opId: string, params: OpParamsMap[N]) => string;

export type VisualLayer = Exclude<Layer, { type: "audio" }>;

export interface CompiledContents {
  contents: ShapeContentOp[];
  /** Gradient ranglari (qatlam Tint'i uchun); gradient bo'lmasa null. */
  gradient: [HexColor, HexColor] | null;
  /** `contents.<id>.<prop>` keyframe'lari. */
  keyframes: { prop: string; keys: ProKey[] }[];
}

type FillLike = {
  color?: HexColor | undefined;
  gradient?: { colors: [HexColor, HexColor] } | undefined;
};

/** Shape contents → op ko'rinishi: id'lar, SVG/nuqtalar → yo'llar, gradient ranglari tekshiruvi. */
export function compileContents(
  contents: readonly ShapeContentSpec[],
  where: string,
): Result<CompiledContents> {
  const out: CompiledContents = { contents: [], gradient: null, keyframes: [] };
  let solid = false;
  let counter = 0;
  const visitPaint = (paint: FillLike | undefined): string | null => {
    if (paint === undefined) return null;
    if (paint.color !== undefined) solid = true;
    if (paint.gradient === undefined) return null;
    const colors = paint.gradient.colors;
    if (out.gradient === null) out.gradient = colors;
    else if (out.gradient[0] !== colors[0] || out.gradient[1] !== colors[1]) {
      return "bitta shape qatlamida gradient ranglari bir xil bo'lishi kerak — boshqa gradientni alohida qatlamga ajrating";
    }
    return null;
  };
  const walk = (items: readonly ShapeContentSpec[]): Result<ShapeContentOp[]> => {
    const ops: ShapeContentOp[] = [];
    for (const item of items) {
      const id = item.id ?? `c${++counter}`;
      const op: ShapeContentOp = { id, kind: item.kind };
      const copy = <K extends keyof ShapeContentOp & keyof ShapeContentSpec>(key: K) => {
        if (item[key] !== undefined) (op as unknown as Record<string, unknown>)[key] = item[key];
      };
      for (const key of [
        "size",
        "position",
        "roundness",
        "points",
        "outer_radius",
        "inner_radius",
        "outer_roundness",
        "inner_roundness",
        "rotation",
        "trim",
        "round_corners",
        "offset_paths",
        "merge",
        "zig_zag",
        "pucker_bloat",
        "twist",
        "wiggle",
        "repeater",
        "transform",
      ] as const) {
        copy(key);
      }
      if (item.kind === "path") {
        let paths: ShapePathOp[];
        try {
          paths = item.svg_d !== undefined ? parseSvgPath(item.svg_d) : [pointsPath(item.path!)];
        } catch (error) {
          return fail(
            "SPEC_INVALID",
            `${where}: ${id}.svg_d — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        op.paths = item.fit === undefined ? paths : fitPaths(paths, item.fit);
      }
      for (const paint of ["fill", "stroke"] as const) {
        const value = item[paint];
        if (value === undefined) continue;
        const problem = visitPaint(value);
        if (problem !== null) return fail("SPEC_INVALID", `${where}: ${id}.${paint} — ${problem}`);
        const { gradient, ...rest } = value;
        const paintOp = { ...rest } as Record<string, unknown>;
        if (gradient !== undefined) {
          paintOp.gradient = {
            type: gradient.type ?? "linear",
            start: gradient.start,
            end: gradient.end,
          };
        }
        (op as unknown as Record<string, unknown>)[paint] = paintOp;
      }
      if (item.contents !== undefined) {
        const children = walk(item.contents);
        if (!children.ok) return children;
        op.contents = children.data;
      }
      for (const [sub, keys] of Object.entries(item.keyframes ?? {})) {
        out.keyframes.push({ prop: `contents.${id}.${sub}`, keys });
      }
      ops.push(op);
    }
    return ok(ops);
  };
  const compiled = walk(contents);
  if (!compiled.ok) return compiled;
  if (out.gradient !== null && solid) {
    return fail(
      "SPEC_INVALID",
      `${where}: gradientli shape qatlamida oddiy rangli fill/stroke bo'lmasligi kerak (gradient qatlam Tint'i bilan bo'yaladi) — ularni alohida qatlamga ajrating`,
    );
  }
  out.contents = compiled.data;
  return ok(out);
}

/** Maska shakli → yo'l (birinchi kichik yo'l). */
export function maskPath(mask: MaskSpec, where: string): Result<ShapePathOp> {
  if (mask.rect !== undefined) return ok(rectPath(mask.rect, mask.roundness ?? 0));
  if (mask.ellipse !== undefined) return ok(ellipsePath(mask.ellipse));
  if (mask.path !== undefined) return ok(pointsPath(mask.path));
  try {
    const paths = parseSvgPath(mask.svg_d ?? "");
    return ok(paths[0]!);
  } catch (error) {
    return fail(
      "SPEC_INVALID",
      `${where}: maska svg_d — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function transformOp(layer: VisualLayer): LayerTransformOp | null {
  const t = layer.transform;
  if (t === undefined) return null;
  const op: LayerTransformOp = {};
  if (t.anchor !== undefined) op.anchor = [...t.anchor];
  if (t.position !== undefined) op.position = [...t.position];
  if (t.scale !== undefined) {
    op.scale =
      typeof t.scale === "number"
        ? layer.three_d === true
          ? [t.scale, t.scale, t.scale]
          : [t.scale, t.scale]
        : [...t.scale];
  }
  if (t.rotation !== undefined) op.rotation = t.rotation;
  if (t.opacity !== undefined) op.opacity = t.opacity;
  if (t.rotation_x !== undefined) op.rotation_x = t.rotation_x;
  if (t.rotation_y !== undefined) op.rotation_y = t.rotation_y;
  if (t.orientation !== undefined) op.orientation = [...t.orientation];
  return op;
}

type KeyValue = Keyframe["v"];

/**
 * Qatlamning professional maydonlari. `refOf` — sahnadagi layer id → op ref. `links` — parent/matte
 * oplari: sahnaning hamma layerlari yaratilgandan keyin chaqiriladi.
 */
export function emitPro(
  add: AddOp,
  layer: VisualLayer,
  opId: string,
  refOf: (id: string) => string,
  links: (() => void)[],
  extraKeys: { prop: string; keys: ProKey[] }[] = [],
): Result<void> {
  let n = 0;
  const keyOps = (prop: string, keys: readonly ProKey[], map?: (v: KeyValue) => KeyValue) => {
    add("prop.keyframes", `${opId}.k${n++}`, {
      layer: opId,
      prop,
      keys: keys.map((key) => {
        const v = map === undefined ? key.v : map(key.v);
        return key.ease === undefined ? { t: key.t, v } : { t: key.t, v, ease: key.ease };
      }),
      ease: "linear",
      relative: true,
    });
  };
  const scaled = (k: number | undefined) =>
    k === undefined
      ? undefined
      : (v: KeyValue): KeyValue => (typeof v === "number" ? round(v * k) : v);
  const pair = (v: KeyValue): KeyValue => (typeof v === "number" ? [v, v] : v);

  // 1. 3D, transform, blend — keyframe'lardan oldin (3D xususiyatlar mavjud bo'lishi uchun).
  const set: OpParamsMap["layer.set"] = { layer: opId };
  if (layer.three_d !== undefined) set.three_d = layer.three_d;
  if (layer.motion_blur !== undefined) set.motion_blur = layer.motion_blur;
  const transform = transformOp(layer);
  if (transform !== null) set.transform = transform;
  if (layer.blend !== undefined && layer.blend !== "normal") set.blend = layer.blend;
  if (Object.keys(set).length > 1) add("layer.set", `${opId}.set`, set);

  // 2. Effektlar (tartib bilan) va ularning keyframe'lari.
  const fxById = new Map<string, string>();
  for (const [i, effect] of (layer.effects ?? []).entries()) {
    const id = effect.id ?? `fx${i + 1}`;
    const params: Record<string, number | number[] | boolean | string> = {};
    for (const [key, value] of Object.entries(effect.params ?? {})) {
      const mapped = mapFxParam(effect.fx, key, value);
      if (!mapped.ok) return mapped;
      params[mapped.data.key] = mapped.data.value;
    }
    const op: OpParamsMap["fx.add"] = { layer: opId, matchName: fxMatchName(effect.fx), name: id };
    if (Object.keys(params).length > 0) op.params = params;
    if (effect.enabled === false) op.enabled = false;
    add("fx.add", `${opId}.fx${i}`, op);
    fxById.set(id, effect.fx);
    for (const [param, keys] of Object.entries(effect.keyframes ?? {})) {
      const { key, scale } = fxParamKey(effect.fx, param);
      keyOps(`effects.${id}.${key}`, keys, scaled(scale));
    }
  }

  // 3. Maskalar.
  for (const [i, mask] of (layer.masks ?? []).entries()) {
    const id = mask.id ?? `m${i + 1}`;
    const path = maskPath(mask, opId);
    if (!path.ok) return path;
    const op: OpParamsMap["layer.mask"] = {
      layer: opId,
      id,
      path: path.data,
      mode: mask.mode ?? "add",
    };
    if (mask.feather !== undefined) {
      op.feather = typeof mask.feather === "number" ? [mask.feather, mask.feather] : mask.feather;
    }
    if (mask.expansion !== undefined) op.expansion = mask.expansion;
    if (mask.opacity !== undefined) op.opacity = mask.opacity;
    if (mask.inverted !== undefined) op.inverted = mask.inverted;
    add("layer.mask", `${opId}.mask${i}`, op);
    for (const [prop, keys] of Object.entries(mask.keyframes ?? {})) {
      keyOps(`masks.${id}.${prop}`, keys, prop === "feather" ? pair : undefined);
    }
  }

  // 4. Qatlam keyframe'lari (+ shape contents keyframe'lari).
  for (const [prop, keys] of Object.entries(layer.keyframes ?? {})) {
    if (prop.startsWith("effects.")) {
      const [, id, ...rest] = prop.split(".");
      const fx = fxById.get(id ?? "");
      if (fx === undefined) {
        return fail("SPEC_INVALID", `${opId}: keyframes.${prop} — '${id}' id'li effekt yo'q`);
      }
      const { key, scale } = fxParamKey(fx, rest.join("."));
      keyOps(`effects.${id}.${key}`, keys, scaled(scale));
    } else if (prop.startsWith("masks.") && prop.endsWith(".feather")) {
      keyOps(prop, keys, pair);
    } else if (prop === "scale") {
      keyOps(prop, keys, (v) =>
        typeof v === "number" ? (layer.three_d === true ? [v, v, v] : [v, v]) : v,
      );
    } else {
      keyOps(prop, keys);
    }
  }
  for (const extra of extraKeys)
    keyOps(extra.prop, extra.keys, extra.prop.endsWith(".scale") ? pair : undefined);

  // 5. Gibrid: expression'lar, presetlar, text animator (skript natijasi log'ga, job to'xtamaydi).
  for (const [prop, value] of Object.entries(layer.expressions ?? {})) {
    const code = expandExpression(value);
    if (!code.ok) return code;
    add("prop.expression", `${opId}.x${n++}`, { layer: opId, prop, code: code.data });
  }
  for (const [i, preset] of (layer.presets ?? []).entries()) {
    add("jsx.run", `${opId}.preset${i}`, {
      code: SCRIPT_LIB.apply_preset!.code,
      args: { __ref: opId, name: preset.name, at: preset.at },
      once: true,
      label: `preset:${preset.name}`,
    });
  }
  if (layer.text_anim !== undefined && layer.type === "text") {
    add("jsx.run", `${opId}.textanim`, {
      code: SCRIPT_LIB.text_words!.code,
      args: { __ref: opId, ...layer.text_anim },
      once: true,
      label: "text_anim",
    });
  }

  // 6. Parent va matte — sahnaning hamma layerlari yaratilgandan keyin.
  if (layer.parent !== undefined || layer.matte !== undefined) {
    const link: OpParamsMap["layer.set"] = { layer: opId };
    if (layer.parent !== undefined) link.parent = refOf(layer.parent);
    if (layer.matte !== undefined) {
      link.matte = { source: refOf(layer.matte.source), type: layer.matte.type ?? "alpha" };
    }
    links.push(() => add("layer.set", `${opId}.link`, link));
  }
  return ok(undefined);
}

/** Professional maydon bormi (variantlarda masshtab ogohlantirishi uchun). */
export function hasPixelFields(layer: VisualLayer): boolean {
  return (layer.effects?.length ?? 0) > 0 || (layer.masks?.length ?? 0) > 0;
}

/** Variant: shape contents geometriyasi `k` bilan; transform/keyframes `position` format nisbatida. */
export function scalePro<T extends VisualLayer>(layer: T, k: number, rx: number, ry: number): T {
  const v = (x: Vec2 | undefined): Vec2 | undefined =>
    x === undefined ? undefined : [round(x[0] * k), round(x[1] * k)];
  const n = (x: number | undefined) => (x === undefined ? undefined : round(x * k));
  const pos = (x: number[]): number[] =>
    x.map((value, i) => round(i === 0 ? value * rx : i === 1 ? value * ry : value));
  const content = (c: ShapeContentSpec): ShapeContentSpec => ({
    ...c,
    size: v(c.size),
    position: v(c.position),
    roundness: n(c.roundness),
    outer_radius: n(c.outer_radius),
    inner_radius: n(c.inner_radius),
    path:
      c.path === undefined
        ? undefined
        : {
            ...c.path,
            points: c.path.points.map((p) => v(p)!),
            in: c.path.in?.map((p) => v(p)!),
            out: c.path.out?.map((p) => v(p)!),
          },
    fit: v(c.fit),
    stroke:
      c.stroke === undefined
        ? undefined
        : { ...c.stroke, width: n(c.stroke.width)!, dashes: c.stroke.dashes?.map((d) => n(d)!) },
    round_corners: n(c.round_corners),
    repeater:
      c.repeater === undefined ? undefined : { ...c.repeater, position: v(c.repeater.position) },
    transform:
      c.transform === undefined
        ? undefined
        : { ...c.transform, anchor: v(c.transform.anchor), position: v(c.transform.position) },
    contents: c.contents?.map(content),
  });
  const out = { ...layer } as T;
  if (layer.transform?.position !== undefined) {
    out.transform = { ...layer.transform, position: pos(layer.transform.position) as Vec2 };
  }
  const position = layer.keyframes?.position;
  if (position !== undefined) {
    out.keyframes = {
      ...layer.keyframes,
      position: position.map((key) => (Array.isArray(key.v) ? { ...key, v: pos(key.v) } : key)),
    };
  }
  if (layer.type === "shape" && layer.contents !== undefined) {
    (out as Extract<VisualLayer, { type: "shape" }>).contents = layer.contents.map(content);
  }
  return out;
}
