/**
 * SVG path (`d`) → AE Shape yo'llari (update-technicalguidline §4.4): vertices + inTangents/outTangents
 * (tangentlar nuqtaga nisbatan). Buyruqlar: M L H V C S Q T A Z (kichik harf — nisbiy). Arc kubik
 * bezier'larga bo'linadi (≤ 90°). Har `M` — alohida yo'l.
 */
import type { ShapePathOp, Vec2 } from "@aes/shared";
import { round } from "./layout";

const KAPPA = 0.5522847498307936;

class Scanner {
  private i = 0;
  constructor(private readonly s: string) {}

  private skip(): void {
    while (this.i < this.s.length && /[\s,]/.test(this.s[this.i]!)) this.i++;
  }

  done(): boolean {
    this.skip();
    return this.i >= this.s.length;
  }

  command(): string | null {
    this.skip();
    const c = this.s[this.i];
    if (c !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      this.i++;
      return c;
    }
    return null;
  }

  /** Keyingi belgi son boshlanishimi (buyruq takrorlanishi uchun). */
  hasNumber(): boolean {
    this.skip();
    const c = this.s[this.i];
    return c !== undefined && /[-+.\d]/.test(c);
  }

  number(): number {
    this.skip();
    const match = /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/.exec(this.s.slice(this.i));
    if (match === null) throw new Error(`son kutilgan (${this.i}-belgi)`);
    this.i += match[0].length;
    return Number(match[0]);
  }

  /** Arc bayroqlari ajratuvchisiz yozilishi mumkin ("011"). */
  flag(): number {
    this.skip();
    const c = this.s[this.i];
    if (c !== "0" && c !== "1") throw new Error(`arc bayrog'i 0/1 kutilgan (${this.i}-belgi)`);
    this.i++;
    return Number(c);
  }
}

interface Vertex {
  p: Vec2;
  /** Absolyut boshqaruv nuqtalari. */
  inC: Vec2;
  outC: Vec2;
}

function arcToCubics(
  from: Vec2,
  rxIn: number,
  ryIn: number,
  angle: number,
  large: number,
  sweep: number,
  to: Vec2,
): [Vec2, Vec2, Vec2][] {
  // SVG 1.1 F.6.5: endpoint → markaz parametrlari.
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [[from, to, to]];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2;
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / segments;
  const alpha = (4 / 3) * Math.tan(step / 4);
  const point = (t: number): Vec2 => [
    cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  ];
  const deriv = (t: number): Vec2 => [
    -rx * Math.sin(t) * cos - ry * Math.cos(t) * sin,
    -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos,
  ];
  const out: [Vec2, Vec2, Vec2][] = [];
  for (let i = 0; i < segments; i++) {
    const t1 = theta1 + i * step;
    const t2 = t1 + step;
    const p1 = point(t1);
    const p2 = i === segments - 1 ? to : point(t2);
    const d1 = deriv(t1);
    const d2 = deriv(t2);
    out.push([
      [p1[0] + alpha * d1[0], p1[1] + alpha * d1[1]],
      [p2[0] - alpha * d2[0], p2[1] - alpha * d2[1]],
      p2,
    ]);
  }
  return out;
}

function toOp(vertices: Vertex[], closed: boolean): ShapePathOp {
  return {
    points: vertices.map((v) => [round(v.p[0]), round(v.p[1])] as Vec2),
    in: vertices.map((v) => [round(v.inC[0] - v.p[0]), round(v.inC[1] - v.p[1])] as Vec2),
    out: vertices.map((v) => [round(v.outC[0] - v.p[0]), round(v.outC[1] - v.p[1])] as Vec2),
    closed,
  };
}

/** SVG `d` → yo'llar. Xato bo'lsa `Error` (xabari bilan). */
export function parseSvgPath(d: string): ShapePathOp[] {
  const scan = new Scanner(d);
  const paths: ShapePathOp[] = [];
  let vertices: Vertex[] = [];
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let prevCmd = "";
  let prevCtrl: Vec2 | null = null;

  const flush = (closed: boolean) => {
    if (vertices.length > 0) {
      if (closed && vertices.length > 1) {
        const first = vertices[0]!;
        const last = vertices[vertices.length - 1]!;
        if (Math.abs(first.p[0] - last.p[0]) < 1e-6 && Math.abs(first.p[1] - last.p[1]) < 1e-6) {
          first.inC = last.inC;
          vertices.pop();
        }
      }
      paths.push(toOp(vertices, closed));
    }
    vertices = [];
  };
  const lineTo = (p: Vec2) => {
    vertices.push({ p, inC: p, outC: p });
    cur = p;
  };
  const curveTo = (c1: Vec2, c2: Vec2, p: Vec2) => {
    const last = vertices[vertices.length - 1];
    if (last !== undefined) last.outC = c1;
    vertices.push({ p, inC: c2, outC: p });
    cur = p;
  };

  let cmd = scan.command();
  if (cmd === null || (cmd !== "M" && cmd !== "m"))
    throw new Error("yo'l M bilan boshlanishi kerak");
  while (cmd !== null) {
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    const pt = (): Vec2 => {
      const x = scan.number();
      const y = scan.number();
      return rel ? [cur[0] + x, cur[1] + y] : [x, y];
    };
    let first = true;
    do {
      switch (upper) {
        case "M": {
          const p = pt();
          if (first) {
            flush(false);
            start = p;
            vertices.push({ p, inC: p, outC: p });
            cur = p;
          } else {
            lineTo(p);
          }
          prevCtrl = null;
          break;
        }
        case "L":
          lineTo(pt());
          prevCtrl = null;
          break;
        case "H": {
          const x = scan.number();
          lineTo([rel ? cur[0] + x : x, cur[1]]);
          prevCtrl = null;
          break;
        }
        case "V": {
          const y = scan.number();
          lineTo([cur[0], rel ? cur[1] + y : y]);
          prevCtrl = null;
          break;
        }
        case "C": {
          const c1 = pt();
          const c2 = pt();
          const p = pt();
          curveTo(c1, c2, p);
          prevCtrl = c2;
          break;
        }
        case "S": {
          const c1: Vec2 =
            prevCtrl !== null && /[CS]/.test(prevCmd)
              ? [2 * cur[0] - prevCtrl[0], 2 * cur[1] - prevCtrl[1]]
              : cur;
          const c2 = pt();
          const p = pt();
          curveTo(c1, c2, p);
          prevCtrl = c2;
          break;
        }
        case "Q":
        case "T": {
          const q: Vec2 =
            upper === "Q"
              ? pt()
              : prevCtrl !== null && /[QT]/.test(prevCmd)
                ? [2 * cur[0] - prevCtrl[0], 2 * cur[1] - prevCtrl[1]]
                : cur;
          const from = cur;
          const p = pt();
          curveTo(
            [from[0] + (2 / 3) * (q[0] - from[0]), from[1] + (2 / 3) * (q[1] - from[1])],
            [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
            p,
          );
          prevCtrl = q;
          break;
        }
        case "A": {
          const rx = scan.number();
          const ry = scan.number();
          const rot = scan.number();
          const large = scan.flag();
          const sweep = scan.flag();
          const p = pt();
          for (const [c1, c2, end] of arcToCubics(cur, rx, ry, rot, large, sweep, p)) {
            curveTo(c1, c2, end);
          }
          prevCtrl = null;
          break;
        }
        case "Z":
          flush(true);
          cur = start;
          prevCtrl = null;
          break;
      }
      prevCmd = upper === "M" && !first ? "L" : upper;
      first = false;
    } while (upper !== "Z" && scan.hasNumber());
    cmd = scan.command();
    if (cmd === null && !scan.done()) throw new Error("noma'lum buyruq");
  }
  flush(false);
  if (paths.length === 0) throw new Error("yo'l bo'sh");
  return paths;
}

/** Yo'llarni `[w, h]` ichiga sig'diradi va markazni (0,0) ga qo'yadi (boshqaruv nuqtalari bilan). */
export function fitPaths(paths: ShapePathOp[], size: Vec2): ShapePathOp[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    path.points.forEach((p, i) => {
      for (const q of [p, add(p, path.in[i]!), add(p, path.out[i]!)]) {
        minX = Math.min(minX, q[0]);
        minY = Math.min(minY, q[1]);
        maxX = Math.max(maxX, q[0]);
        maxY = Math.max(maxY, q[1]);
      }
    });
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const s = Math.min(w > 0 ? size[0] / w : Infinity, h > 0 ? size[1] / h : Infinity);
  const k = Number.isFinite(s) ? s : 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = (v: Vec2): Vec2 => [round(v[0] * k), round(v[1] * k)];
  return paths.map((path) => ({
    points: path.points.map((p) => [round((p[0] - cx) * k), round((p[1] - cy) * k)] as Vec2),
    in: path.in.map(scale),
    out: path.out.map(scale),
    closed: path.closed,
  }));
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

/** Nuqtalar ro'yxati → yo'l (tangentlar berilmasa 0). */
export function pointsPath(data: {
  points: Vec2[];
  in?: Vec2[] | undefined;
  out?: Vec2[] | undefined;
  closed?: boolean | undefined;
}): ShapePathOp {
  const zero = (n: number) => Array.from({ length: n }, (): Vec2 => [0, 0]);
  return {
    points: data.points,
    in: data.in ?? zero(data.points.length),
    out: data.out ?? zero(data.points.length),
    closed: data.closed ?? true,
  };
}

/** `[x, y, w, h]` to'rtburchak (burchak radiusi bilan) → yo'l (soat yo'nalishida). */
export function rectPath(rect: [number, number, number, number], radius = 0): ShapePathOp {
  const [x, y, w, h] = rect;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) {
    return pointsPath({
      points: [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      closed: true,
    });
  }
  const c = r * KAPPA;
  const points: Vec2[] = [
    [x + r, y],
    [x + w - r, y],
    [x + w, y + r],
    [x + w, y + h - r],
    [x + w - r, y + h],
    [x + r, y + h],
    [x, y + h - r],
    [x, y + r],
  ];
  const ins: Vec2[] = [
    [-c, 0],
    [0, 0],
    [0, -c],
    [0, 0],
    [c, 0],
    [0, 0],
    [0, c],
    [0, 0],
  ];
  const outs: Vec2[] = [
    [0, 0],
    [c, 0],
    [0, 0],
    [0, c],
    [0, 0],
    [-c, 0],
    [0, 0],
    [0, -c],
  ];
  return {
    points: points.map(([px, py]) => [round(px), round(py)] as Vec2),
    in: ins.map(([px, py]) => [round(px), round(py)] as Vec2),
    out: outs.map(([px, py]) => [round(px), round(py)] as Vec2),
    closed: true,
  };
}

/** `[x, y, w, h]` ichidagi ellips → 4 nuqtali bezier yo'l. */
export function ellipsePath(rect: [number, number, number, number]): ShapePathOp {
  const [x, y, w, h] = rect;
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = round(rx * KAPPA);
  const ky = round(ry * KAPPA);
  return {
    points: [
      [round(cx), round(cy - ry)],
      [round(cx + rx), round(cy)],
      [round(cx), round(cy + ry)],
      [round(cx - rx), round(cy)],
    ],
    in: [
      [-kx, 0],
      [0, -ky],
      [kx, 0],
      [0, ky],
    ],
    out: [
      [kx, 0],
      [0, ky],
      [-kx, 0],
      [0, -ky],
    ],
    closed: true,
  };
}
