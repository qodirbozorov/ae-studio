/**
 * Ikonka/logo SVG'si (`IconData`: `body` + viewBox) → AE shape contents (`as_shapes`): AE'ning "Create Shapes
 * from Vector Layer" buyrug'isiz, geometriyadan to'g'ridan-to'g'ri. Natija aniq `size` px kvadratga sig'adi
 * (nisbat saqlanadi) va markazi qatlam boshida (0, 0) — qatlam `pos` i ikonka markazi bo'ladi.
 *
 * Qo'llab-quvvatlanadi: path, circle, ellipse, rect (rx/ry), line, polyline, polygon, g, defs/symbol/use;
 * meros bo'yicha fill/stroke (+opacity), stroke-width/linecap/linejoin/miterlimit, fill-rule, opacity,
 * transform, `style` atributi va `<style>` (oddiy selektorlar: .klass, #id, teg, teg.klass). Gradient,
 * mask, clipPath, rasm, matn — yo'q: `null` (chaqiruvchi PDF footage'ga qaytadi).
 */
import type { HexColor, IconData, ShapeContentOp, ShapePathOp, Vec2 } from "@aes/shared";
import { round } from "./layout";
import { parseSvgPath } from "./svg";

/** Affine matritsa [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Op sxemasi chegaralari: guruhda ≤ 100 element, bitta contents'da ≤ 200 yo'l. */
const MAX_GROUP = 100;
const MAX_PATHS = 200;

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** `transform` atributi (matrix, translate, scale, rotate, skewX, skewY) → matritsa; xato bo'lsa null. */
export function parseTransform(value: string): Matrix | null {
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  const rest = value.replace(re, "").replace(/[\s,]/g, "");
  if (rest !== "") return null;
  for (const match of value.matchAll(re)) {
    const args = match[2]!
      .split(/[\s,]+/)
      .filter((v) => v !== "")
      .map(Number);
    if (args.some((v) => !Number.isFinite(v))) return null;
    const [a = 0, b, c, d, e, f] = args;
    let t: Matrix;
    switch (match[1]) {
      case "matrix":
        if (args.length !== 6) return null;
        t = [a, b!, c!, d!, e!, f!];
        break;
      case "translate":
        t = [1, 0, 0, 1, a, b ?? 0];
        break;
      case "scale":
        t = [a, 0, 0, b ?? a, 0, 0];
        break;
      case "rotate": {
        const r = (a * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        t =
          b === undefined
            ? rot
            : multiply(multiply([1, 0, 0, 1, b, c ?? 0], rot), [1, 0, 0, 1, -b, -(c ?? 0)]);
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  return m;
}

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  /** Ichidagi matn (faqat `<style>`). */
  text: string;
}

/** Matn saqlashi mumkin bo'lgan elementlar (title/desc/metadata e'tiborsiz, style — CSS). */
const TEXT_TAGS = new Set(["title", "desc", "metadata", "style"]);
/** Matn bo'la oladigan joy: yuqoridagilar va nomlar fazosidagi (sodipodi:, rdf:) elementlar ichida. */
const textAllowed = (stack: Node[]) =>
  stack.some(
    (node) => node.tag !== "style" && (TEXT_TAGS.has(node.tag) || node.tag.includes(":")),
  ) || stack.at(-1)!.tag === "style";
/** Chizilmaydigan, e'tiborsiz elementlar. */
const IGNORED = new Set(["title", "desc", "metadata", "style", "defs", "symbol"]);

/** SVG bo'lagi → elementlar daraxti; yaxshi shakllanmagan bo'lsa null. */
function parseBody(body: string): Node[] | null {
  const root: Node = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack: Node[] = [root];
  const re =
    /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  for (const match of body.matchAll(re)) {
    const top = stack.at(-1)!;
    const between = body.slice(last, match.index);
    if (between.trim() !== "") {
      if (!textAllowed(stack)) return null;
      top.text += between;
    }
    last = match.index + match[0].length;
    if (match[5] !== undefined) {
      if (!textAllowed(stack)) return null;
      top.text += match[5];
      continue;
    }
    if (match[2] === undefined) continue;
    const [, closing, tag, rawAttrs, selfClosing] = match;
    if (closing === "/") {
      if (stack.length === 1 || top.tag !== tag) return null;
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]!] = a[2] ?? a[3] ?? "";
    }
    const node: Node = { tag: tag!, attrs, children: [], text: "" };
    top.children.push(node);
    if (selfClosing !== "/") stack.push(node);
  }
  if (stack.length !== 1 || body.slice(last).trim() !== "") return null;
  return root.children;
}

interface CssRule {
  selectors: { tag: string | null; id: string | null; classes: string[] }[];
  decls: Record<string, string>;
}

/** Oddiy CSS (`.a,.b{fill:#fff}`). Murakkab selektor yoki @-qoida bo'lsa null. */
function parseCss(text: string): CssRule[] | null {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (css.includes("@")) return null;
  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors: CssRule["selectors"] = [];
    for (const raw of match[1]!.split(",")) {
      const sel = raw.trim();
      const m = /^([a-zA-Z][\w-]*)?(?:#([\w-]+))?((?:\.[\w-]+)*)$/.exec(sel);
      if (sel === "" || m === null) return null;
      selectors.push({
        tag: m[1] ?? null,
        id: m[2] ?? null,
        classes: (m[3] ?? "").split(".").filter((c) => c !== ""),
      });
    }
    rules.push({ selectors, decls: declarations(match[2]!) });
  }
  if (css.replace(/([^{}]+)\{([^{}]*)\}/g, "").trim() !== "") return null;
  return rules;
}

function declarations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of text.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0)
      out[decl.slice(0, i).trim()] = decl
        .slice(i + 1)
        .replace(/!important/, "")
        .trim();
  }
  return out;
}

const NAMED: Record<string, HexColor> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  lime: "#00FF00",
  blue: "#0000FF",
  navy: "#000080",
  yellow: "#FFFF00",
  orange: "#FFA500",
  gold: "#FFD700",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  darkgray: "#A9A9A9",
  darkgrey: "#A9A9A9",
  lightgray: "#D3D3D3",
  lightgrey: "#D3D3D3",
  maroon: "#800000",
  purple: "#800080",
  fuchsia: "#FF00FF",
  magenta: "#FF00FF",
  teal: "#008080",
  aqua: "#00FFFF",
  cyan: "#00FFFF",
  olive: "#808000",
  brown: "#A52A2A",
  pink: "#FFC0CB",
  crimson: "#DC143C",
  indigo: "#4B0082",
  violet: "#EE82EE",
};

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

/**
 * SVG rang → `{ color, alpha }` | "none" | null (qo'llab-quvvatlanmaydi: gradient `url(...)` va h.k.).
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, nomli ranglar, `currentColor`.
 */
function parseColor(
  value: string,
  current: HexColor,
): { color: HexColor; alpha: number } | "none" | null {
  const v = value.trim();
  if (v === "none" || v === "transparent") return "none";
  if (v === "currentColor" || v === "currentcolor") return { color: current, alpha: 1 };
  const named = NAMED[v.toLowerCase()];
  if (named !== undefined) return { color: named, alpha: 1 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex !== null) {
    const h = hex[1]!;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1;
    return { color: `#${full.slice(0, 6).toUpperCase()}`, alpha };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(
      v,
    );
  if (rgb !== null) {
    const channel = (s: string) => (s.endsWith("%") ? (parseFloat(s) * 255) / 100 : parseFloat(s));
    const a = rgb[4];
    const alpha = a === undefined ? 1 : a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
    return {
      color: `#${[rgb[1]!, rgb[2]!, rgb[3]!]
        .map((c) => hex2(channel(c)))
        .join("")
        .toUpperCase()}`,
      alpha: Math.max(0, Math.min(1, alpha)),
    };
  }
  return null;
}

interface Style {
  fill: HexColor | "none";
  fillOpacity: number;
  fillRule: "nonzero" | "evenodd";
  stroke: HexColor | "none";
  strokeOpacity: number;
  strokeWidth: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  miter: number;
  opacity: number;
  matrix: Matrix;
}

const SHAPES = new Set(["path", "circle", "ellipse", "rect", "line", "polyline", "polygon"]);

const num = (attrs: Record<string, string>, key: string, fallback = 0): number => {
  const v = attrs[key];
  if (v === undefined) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Element → SVG path `d`. */
function pathData(tag: string, a: Record<string, string>): string | null {
  switch (tag) {
    case "path":
      return a.d ?? null;
    case "line":
      return `M${num(a, "x1")} ${num(a, "y1")}L${num(a, "x2")} ${num(a, "y2")}`;
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (pts.length < 4 || pts.length % 2 !== 0 || pts.some((v) => !Number.isFinite(v)))
        return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return tag === "polygon" ? `${d}Z` : d;
    }
    case "circle":
    case "ellipse": {
      const cx = num(a, "cx");
      const cy = num(a, "cy");
      const rx = tag === "circle" ? num(a, "r") : num(a, "rx", num(a, "ry"));
      const ry = tag === "circle" ? rx : num(a, "ry", rx);
      if (rx <= 0 || ry <= 0) return null;
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case "rect": {
      const x = num(a, "x");
      const y = num(a, "y");
      const w = num(a, "width");
      const h = num(a, "height");
      if (w <= 0 || h <= 0) return null;
      let rx = a.rx === undefined ? num(a, "ry") : num(a, "rx");
      let ry = a.ry === undefined ? rx : num(a, "ry");
      rx = Math.min(Math.max(0, rx), w / 2);
      ry = Math.min(Math.max(0, ry), h / 2);
      if (rx === 0 || ry === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return (
        `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
        `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
      );
    }
    default:
      return null;
  }
}

function transformPath(path: ShapePathOp, m: Matrix): ShapePathOp {
  const point = (p: Vec2): Vec2 => [
    round(m[0] * p[0] + m[2] * p[1] + m[4]),
    round(m[1] * p[0] + m[3] * p[1] + m[5]),
  ];
  const vector = (v: Vec2): Vec2 => [
    round(m[0] * v[0] + m[2] * v[1]),
    round(m[1] * v[0] + m[3] * v[1]),
  ];
  return {
    points: path.points.map(point),
    in: path.in.map(vector),
    out: path.out.map(vector),
    closed: path.closed,
  };
}

const percent = (v: number) => round(Math.max(0, Math.min(1, v)) * 100);

/** Bir xil bo'yoq (fill/stroke) — ketma-ket guruhlarni birlashtirish uchun. */
const paintKey = (c: ShapeContentOp) => JSON.stringify([c.fill ?? null, c.stroke ?? null]);

/**
 * Op chegaralariga moslash: 100 dan ko'p element bo'lsa ketma-ket bir xil bo'yoqli yo'llar bitta contents'ga
 * (ko'pi 200 yo'l) birlashadi; baribir ko'p bo'lsa 100 talik ichki guruhlarga (`c1`, `c2` …) bo'linadi.
 */
function pack(groups: ShapeContentOp[]): ShapeContentOp[] {
  let list = groups;
  if (list.length > MAX_GROUP) {
    const merged: ShapeContentOp[] = [];
    for (const g of list) {
      const prev = merged.at(-1);
      if (
        prev !== undefined &&
        paintKey(prev) === paintKey(g) &&
        prev.paths!.length + g.paths!.length <= MAX_PATHS
      ) {
        prev.paths = [...prev.paths!, ...g.paths!];
      } else merged.push({ ...g });
    }
    list = merged.map((g, i) => ({ ...g, id: `p${i + 1}` }));
  }
  let level = 0;
  while (list.length > MAX_GROUP) {
    level++;
    const chunks: ShapeContentOp[] = [];
    for (let i = 0; i < list.length; i += MAX_GROUP) {
      chunks.push({
        id: `c${level}_${chunks.length + 1}`,
        kind: "group",
        contents: list.slice(i, i + MAX_GROUP),
      });
    }
    list = chunks;
  }
  return list;
}

/**
 * Ikonka → shape contents: ildiz guruh `icon` (butun ikonka; trim/transform keyframe'lari uchun) ichida har
 * chiziladigan element alohida guruh `p1`, `p2` … SVG tartibida (keyingisi ustida). `strokeWidth` — chiziqli
 * ikonkalarda aniq yozilgan `stroke-width` o'rniga (null — logolarda asl qalinlik). Qo'llab-quvvatlanmaydigan
 * narsa bo'lsa null.
 */
export function iconShapeContents(
  icon: IconData,
  size: number,
  color: HexColor,
  strokeWidth: number | null,
): ShapeContentOp[] | null {
  const nodes = parseBody(icon.body);
  if (nodes === null) return null;

  // `<style>` qoidalari va id → element (use uchun).
  const rules: CssRule[] = [];
  const byId = new Map<string, Node>();
  let broken = false;
  const index = (list: Node[]) => {
    for (const node of list) {
      if (node.tag === "style") {
        const parsed = parseCss(node.text);
        if (parsed === null) broken = true;
        else rules.push(...parsed);
      }
      if (node.attrs.id !== undefined) byId.set(node.attrs.id, node);
      index(node.children);
    }
  };
  index(nodes);
  if (broken) return null;

  // viewBox → `size` px kvadrat (nisbat saqlanadi), markaz (0, 0) da.
  const k = size / Math.max(icon.width, icon.height);
  const fit: Matrix = [
    k,
    0,
    0,
    k,
    -(icon.left + icon.width / 2) * k,
    -(icon.top + icon.height / 2) * k,
  ];
  const base: Style = {
    fill: "#000000",
    fillOpacity: 1,
    fillRule: "nonzero",
    stroke: "none",
    strokeOpacity: 1,
    strokeWidth: 1,
    cap: "butt",
    join: "miter",
    miter: 4,
    opacity: 1,
    matrix: fit,
  };
  const groups: ShapeContentOp[] = [];
  let unsupported = false;

  /** Atributlar < `<style>` qoidalari < `style` atributi (SVG/CSS ustuvorligi). */
  const properties = (node: Node): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(node.attrs)) if (!key.includes(":")) out[key] = value;
    const classes = (node.attrs.class ?? "").split(/\s+/).filter((c) => c !== "");
    for (const rule of rules) {
      const hit = rule.selectors.some(
        (sel) =>
          (sel.tag === null || sel.tag === node.tag) &&
          (sel.id === null || sel.id === node.attrs.id) &&
          sel.classes.every((c) => classes.includes(c)),
      );
      if (hit) Object.assign(out, rule.decls);
    }
    Object.assign(out, declarations(node.attrs.style ?? ""));
    return out;
  };

  const visit = (node: Node, parent: Style, depth: number): void => {
    if (unsupported) return;
    // Nomlar fazosidagi (sodipodi:, inkscape:) va chizilmaydigan elementlar.
    if (node.tag.includes(":") || IGNORED.has(node.tag)) return;
    if (node.tag !== "g" && node.tag !== "use" && !SHAPES.has(node.tag)) {
      unsupported = true;
      return;
    }
    const p = properties(node);
    if (p.display === "none" || p.visibility === "hidden") return;
    const clip = p["clip-path"];
    if (
      (p.mask !== undefined && p.mask !== "none") ||
      (clip !== undefined && clip !== "none") ||
      (p.filter !== undefined && p.filter !== "none")
    ) {
      unsupported = true;
      return;
    }
    const style: Style = { ...parent };
    if (p.transform !== undefined) {
      const t = parseTransform(p.transform);
      if (t === null) {
        unsupported = true;
        return;
      }
      style.matrix = multiply(parent.matrix, t);
    }
    for (const key of ["fill", "stroke"] as const) {
      if (p[key] === undefined) continue;
      const c = parseColor(p[key], color);
      if (c === null) {
        unsupported = true;
        return;
      }
      style[key] = c === "none" ? "none" : c.color;
      if (c !== "none" && c.alpha < 1) {
        if (key === "fill") style.fillOpacity = parent.fillOpacity * c.alpha;
        else style.strokeOpacity = parent.strokeOpacity * c.alpha;
      }
    }
    // Spec qalinligi faqat aniq yozilgan `stroke-width` larni almashtiradi (PDF yo'li bilan bir xil).
    if (p["stroke-width"] !== undefined) {
      style.strokeWidth = strokeWidth ?? num(p, "stroke-width", 1);
    }
    if (p["stroke-linecap"] === "round" || p["stroke-linecap"] === "square") {
      style.cap = p["stroke-linecap"];
    } else if (p["stroke-linecap"] === "butt") style.cap = "butt";
    if (p["stroke-linejoin"] === "round" || p["stroke-linejoin"] === "bevel") {
      style.join = p["stroke-linejoin"];
    } else if (p["stroke-linejoin"] === "miter") style.join = "miter";
    if (p["stroke-miterlimit"] !== undefined) style.miter = num(p, "stroke-miterlimit", 4);
    if (p["fill-rule"] === "evenodd" || p["fill-rule"] === "nonzero")
      style.fillRule = p["fill-rule"];
    if (p["fill-opacity"] !== undefined) style.fillOpacity *= num(p, "fill-opacity", 1);
    if (p["stroke-opacity"] !== undefined) style.strokeOpacity *= num(p, "stroke-opacity", 1);
    if (p.opacity !== undefined) style.opacity = parent.opacity * num(p, "opacity", 1);

    if (node.tag === "g") {
      for (const childNode of node.children) visit(childNode, style, depth);
      return;
    }
    if (node.tag === "use") {
      const href = (node.attrs.href ?? node.attrs["xlink:href"] ?? "").replace(/^#/, "");
      const target = byId.get(href);
      if (target === undefined || depth > 8) {
        unsupported = true;
        return;
      }
      style.matrix = multiply(style.matrix, [1, 0, 0, 1, num(p, "x"), num(p, "y")]);
      const children = target.tag === "symbol" ? target.children : [target];
      // `symbol`/`defs` ichidagisi faqat use orqali chiziladi.
      for (const childNode of children) {
        visit(
          childNode.tag === "symbol" ? { ...childNode, tag: "g" } : childNode,
          style,
          depth + 1,
        );
      }
      return;
    }
    const d = pathData(node.tag, p);
    if (d === null) return;
    let paths: ShapePathOp[];
    try {
      paths = parseSvgPath(d);
    } catch {
      unsupported = true;
      return;
    }
    if (paths.length === 0) return;
    const m = style.matrix;
    // Chiziq qalinligi matritsa masshtabi bilan (bir tekis masshtab; qiyshiq transformda o'rtacha).
    const lineScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    const group: ShapeContentOp = {
      id: `p${groups.length + 1}`,
      kind: "path",
      paths: paths.map((path) => transformPath(path, m)),
    };
    if (style.stroke !== "none" && style.strokeWidth > 0) {
      group.stroke = {
        color: style.stroke,
        width: round(style.strokeWidth * lineScale),
        cap: style.cap,
        join: style.join,
        ...(style.join === "miter" ? { miter_limit: Math.max(1, style.miter) } : {}),
        ...(style.strokeOpacity * style.opacity < 1
          ? { opacity: percent(style.strokeOpacity * style.opacity) }
          : {}),
      };
    }
    if (style.fill !== "none") {
      group.fill = {
        color: style.fill,
        rule: style.fillRule,
        ...(style.fillOpacity * style.opacity < 1
          ? { opacity: percent(style.fillOpacity * style.opacity) }
          : {}),
      };
    }
    if (group.paths!.length > MAX_PATHS) {
      unsupported = true;
      return;
    }
    if (group.stroke !== undefined || group.fill !== undefined) groups.push(group);
  };

  for (const node of nodes) visit(node, base, 0);
  if (unsupported || groups.length === 0) return null;
  // AE'da ro'yxat boshidagi guruh ustida chiziladi: SVG'da keyingi element ustida — teskari tartib.
  return [{ id: "icon", kind: "group", contents: pack(groups.reverse()) }];
}
