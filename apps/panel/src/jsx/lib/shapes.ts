/**
 * Shape contents (Faza 7, update-technicalguidline §4.4): har element — AE vector group (`name` = id).
 * Stek tartibi: yo'l(lar) yoki ichki guruhlar → modifikatorlar → stroke → fill → repeater; so'ng guruh transformi.
 * Gradient: G-Fill/G-Stroke oq → qora (start/end nuqtalar), ranglar qatlamdagi Tint effekti bilan.
 */
import type { ShapeContentOp, ShapeFillOp, ShapePathOp, ShapeStrokeOp } from "@aes/shared/ae";
import { hexToRgb, raise } from "./util";

function add(group: PropertyGroup, matchName: string): PropertyGroup {
  if (!group.canAddProperty(matchName)) {
    return raise("AE_BAD_PARAMS", "Shape elementi qo'shib bo'lmaydi: " + matchName);
  }
  return group.addProperty(matchName) as PropertyGroup;
}

function set(group: PropertyGroup, key: string | number, value: unknown): void {
  if (value === undefined || value === null) return;
  (group.property(key as string) as Property).setValue(value as never);
}

export function makeShape(path: ShapePathOp): Shape {
  const shape = new Shape();
  shape.vertices = path.points;
  shape.inTangents = path.in.length === path.points.length ? path.in : zeros(path.points.length);
  shape.outTangents = path.out.length === path.points.length ? path.out : zeros(path.points.length);
  shape.closed = path.closed;
  return shape;
}

function zeros(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([0, 0]);
  return out;
}

const JOIN: { [name: string]: number | undefined } = { miter: 1, round: 2, bevel: 3 };
const CAP: { [name: string]: number | undefined } = { butt: 1, round: 2, square: 3 };
const MERGE: { [name: string]: number | undefined } = {
  merge: 1,
  add: 2,
  subtract: 3,
  intersect: 4,
  exclude: 5,
};

function gradient(paint: PropertyGroup, g: { type: string; start: number[]; end: number[] }): void {
  set(paint, "ADBE Vector Grad Type", g.type === "radial" ? 2 : 1);
  set(paint, "ADBE Vector Grad Start Pt", g.start);
  set(paint, "ADBE Vector Grad End Pt", g.end);
}

function stroke(vectors: PropertyGroup, s: ShapeStrokeOp): void {
  const paint = add(
    vectors,
    s.gradient === undefined ? "ADBE Vector Graphic - Stroke" : "ADBE Vector Graphic - G-Stroke",
  );
  if (s.gradient !== undefined) gradient(paint, s.gradient);
  else if (s.color !== undefined) set(paint, "ADBE Vector Stroke Color", hexToRgb(s.color));
  set(paint, "ADBE Vector Stroke Width", s.width);
  set(paint, "ADBE Vector Stroke Opacity", s.opacity);
  if (s.cap !== undefined) set(paint, "ADBE Vector Stroke Line Cap", CAP[s.cap]);
  if (s.join !== undefined) set(paint, "ADBE Vector Stroke Line Join", JOIN[s.join]);
  set(paint, "ADBE Vector Stroke Miter Limit", s.miter_limit);
  if (s.dashes !== undefined && s.dashes.length > 0) {
    const dashes = paint.property("ADBE Vector Stroke Dashes") as PropertyGroup;
    for (let i = 0; i < s.dashes.length; i++) {
      const n = Math.floor(i / 2) + 1;
      const item = add(
        dashes,
        i % 2 === 0 ? "ADBE Vector Stroke Dash " + n : "ADBE Vector Stroke Gap " + n,
      ) as unknown as Property;
      item.setValue(s.dashes[i] as never);
    }
    if (s.dash_offset !== undefined) {
      const offset = add(dashes, "ADBE Vector Stroke Offset") as unknown as Property;
      offset.setValue(s.dash_offset as never);
    }
  }
}

function fill(vectors: PropertyGroup, f: ShapeFillOp): void {
  const paint = add(
    vectors,
    f.gradient === undefined ? "ADBE Vector Graphic - Fill" : "ADBE Vector Graphic - G-Fill",
  );
  if (f.gradient !== undefined) gradient(paint, f.gradient);
  else if (f.color !== undefined) set(paint, "ADBE Vector Fill Color", hexToRgb(f.color));
  set(paint, "ADBE Vector Fill Opacity", f.opacity);
  if (f.rule !== undefined) set(paint, "ADBE Vector Fill Rule", f.rule === "evenodd" ? 2 : 1);
}

function geometry(vectors: PropertyGroup, c: ShapeContentOp): void {
  switch (c.kind) {
    case "rect": {
      const item = add(vectors, "ADBE Vector Shape - Rect");
      set(item, "ADBE Vector Rect Size", c.size);
      set(item, "ADBE Vector Rect Position", c.position);
      set(item, "ADBE Vector Rect Roundness", c.roundness);
      return;
    }
    case "ellipse": {
      const item = add(vectors, "ADBE Vector Shape - Ellipse");
      set(item, "ADBE Vector Ellipse Size", c.size);
      set(item, "ADBE Vector Ellipse Position", c.position);
      return;
    }
    case "star":
    case "polygon": {
      const item = add(vectors, "ADBE Vector Shape - Star");
      set(item, "ADBE Vector Star Type", c.kind === "star" ? 1 : 2);
      set(item, "ADBE Vector Star Points", c.points);
      set(item, "ADBE Vector Star Position", c.position);
      set(item, "ADBE Vector Star Rotation", c.rotation);
      set(item, "ADBE Vector Star Outer Radius", c.outer_radius);
      set(item, "ADBE Vector Star Outer Roundess", c.outer_roundness);
      if (c.kind === "star") {
        set(item, "ADBE Vector Star Inner Radius", c.inner_radius);
        set(item, "ADBE Vector Star Inner Roundess", c.inner_roundness);
      }
      return;
    }
    case "path": {
      const paths = c.paths ?? [];
      for (let i = 0; i < paths.length; i++) {
        const item = add(vectors, "ADBE Vector Shape - Group");
        set(item, "ADBE Vector Shape", makeShape(paths[i]!));
      }
      return;
    }
    case "group": {
      const children = c.contents ?? [];
      for (let i = 0; i < children.length; i++) addContent(vectors, children[i]!);
      return;
    }
  }
}

function modifiers(vectors: PropertyGroup, c: ShapeContentOp): void {
  if (c.merge !== undefined)
    set(add(vectors, "ADBE Vector Filter - Merge"), "ADBE Vector Merge Type", MERGE[c.merge]);
  if (c.offset_paths !== undefined) {
    const item = add(vectors, "ADBE Vector Filter - Offset");
    set(item, "ADBE Vector Offset Amount", c.offset_paths.amount);
    if (c.offset_paths.join !== undefined) {
      set(item, "ADBE Vector Offset Line Join", JOIN[c.offset_paths.join]);
    }
  }
  if (c.round_corners !== undefined) {
    set(add(vectors, "ADBE Vector Filter - RC"), "ADBE Vector RoundCorner Radius", c.round_corners);
  }
  if (c.pucker_bloat !== undefined) set(add(vectors, "ADBE Vector Filter - PB"), 1, c.pucker_bloat);
  if (c.twist !== undefined) {
    const item = add(vectors, "ADBE Vector Filter - Twist");
    set(item, 1, c.twist.angle);
    set(item, 2, c.twist.center);
  }
  if (c.zig_zag !== undefined) {
    const item = add(vectors, "ADBE Vector Filter - Zigzag");
    set(item, 1, c.zig_zag.size);
    set(item, 2, c.zig_zag.ridges);
    if (c.zig_zag.smooth !== undefined) set(item, 3, c.zig_zag.smooth ? 2 : 1);
  }
  if (c.wiggle !== undefined) {
    const item = add(vectors, "ADBE Vector Filter - Roughen");
    set(item, 1, c.wiggle.size);
    set(item, 2, c.wiggle.detail);
    set(item, 4, c.wiggle.speed);
    set(item, 8, c.wiggle.seed);
  }
  if (c.trim !== undefined) {
    const item = add(vectors, "ADBE Vector Filter - Trim");
    set(item, "ADBE Vector Trim Start", c.trim.start);
    set(item, "ADBE Vector Trim End", c.trim.end);
    set(item, "ADBE Vector Trim Offset", c.trim.offset);
    if (c.trim.individually !== undefined) {
      set(item, "ADBE Vector Trim Type", c.trim.individually ? 2 : 1);
    }
  }
}

function repeater(vectors: PropertyGroup, c: ShapeContentOp): void {
  const r = c.repeater;
  if (r === undefined) return;
  const item = add(vectors, "ADBE Vector Filter - Repeater");
  set(item, "ADBE Vector Repeater Copies", r.copies);
  set(item, "ADBE Vector Repeater Offset", r.offset);
  if (r.composite !== undefined)
    set(item, "ADBE Vector Repeater Order", r.composite === "above" ? 2 : 1);
  const t = item.property("ADBE Vector Repeater Transform") as PropertyGroup;
  set(t, "ADBE Vector Repeater Position", r.position);
  set(t, "ADBE Vector Repeater Scale", r.scale);
  set(t, "ADBE Vector Repeater Rotation", r.rotation);
  set(t, "ADBE Vector Repeater Opacity 1", r.start_opacity);
  set(t, "ADBE Vector Repeater Opacity 2", r.end_opacity);
}

function transform(group: PropertyGroup, c: ShapeContentOp): void {
  const t = c.transform;
  if (t === undefined) return;
  const g = group.property("ADBE Vector Transform Group") as PropertyGroup;
  set(g, "ADBE Vector Anchor", t.anchor);
  set(g, "ADBE Vector Position", t.position);
  set(g, "ADBE Vector Scale", t.scale);
  set(g, "ADBE Vector Rotation", t.rotation);
  set(g, "ADBE Vector Group Opacity", t.opacity);
  set(g, "ADBE Vector Skew", t.skew);
  set(g, "ADBE Vector Skew Axis", t.skew_axis);
}

/** Bitta element → vector group (`parent` — Root Vectors Group yoki ota guruhning Vectors Group'i). */
export function addContent(parent: PropertyGroup, c: ShapeContentOp): PropertyGroup {
  const group = add(parent, "ADBE Vector Group");
  group.name = c.id;
  const vectors = group.property("ADBE Vectors Group") as PropertyGroup;
  geometry(vectors, c);
  modifiers(vectors, c);
  if (c.stroke !== undefined) stroke(vectors, c.stroke);
  if (c.fill !== undefined) fill(vectors, c.fill);
  repeater(vectors, c);
  transform(group, c);
  return group;
}

/** Gradient ranglari: Tint (oq → [0], qora → [1]) — butun qatlamga. */
export function gradientTint(layer: Layer, colors: [string, string]): void {
  const parade = layer.property("ADBE Effect Parade") as PropertyGroup;
  const tint = add(parade, "ADBE Tint");
  tint.name = "AES Gradient";
  (tint.property(1) as Property).setValue(hexToRgb(colors[1]) as never);
  (tint.property(2) as Property).setValue(hexToRgb(colors[0]) as never);
  (tint.property(3) as Property).setValue(100 as never);
}
