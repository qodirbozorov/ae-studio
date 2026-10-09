/**
 * Easing (update-technicalguidline §4.3, §11-A/B): CSS cubic-bezier → AE KeyframeEase (speed, influence).
 * ES3-xavfsiz (jsx bundle'iga ham kiradi): spread, Array.isArray, Object.keys ishlatilmaydi.
 *
 * Segment A→B uchun T = tB − tA, Δv = vB − vA (spatial'da yo'l uzunligi):
 *   outEase(A) = ( x1>0 ? (y1/x1)·Δv/T : 0 ,  max(0.1, x1·100) )
 *   inEase(B)  = ( x2<1 ? ((1−y2)/(1−x2))·Δv/T : 0 ,  max(0.1, (1−x2)·100) )
 */

export type Bezier = [number, number, number, number];

/** Ease tokenlari (§11-A). */
export const EASE_TOKENS: { [token: string]: Bezier | undefined } = {
  enter: [0.16, 1, 0.3, 1],
  exit: [0.7, 0, 0.84, 0],
  move: [0.65, 0, 0.35, 1],
  soft: [0.333, 0, 0.667, 1],
  pop: [0.34, 1.56, 0.64, 1],
};

/** Xom AE qiymatlari: `[speed, influence]`. */
export interface RawEase {
  in: [number, number];
  out: [number, number];
}

/** Segment egri chizig'i: token, `[x1,y1,x2,y2]`, `linear`, `hold` yoki xom AE qiymatlari. */
export type Curve = string | Bezier | RawEase;

export type ResolvedCurve =
  | { kind: "linear" }
  | { kind: "hold" }
  | { kind: "bezier"; bezier: Bezier }
  | { kind: "raw"; raw: RawEase };

function isList(value: unknown): value is unknown[] {
  return Object.prototype.toString.call(value as object) === "[object Array]";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

function pair(value: unknown): value is [number, number] {
  return isList(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
}

/** Egri chiziqni tasniflaydi; noto'g'ri bo'lsa null. */
export function resolveCurve(curve: unknown): ResolvedCurve | null {
  if (curve === "linear") return { kind: "linear" };
  if (curve === "hold") return { kind: "hold" };
  if (typeof curve === "string") {
    const token = EASE_TOKENS[curve.charAt(0) === "$" ? curve.substring(1) : curve];
    return token === undefined ? null : { kind: "bezier", bezier: token };
  }
  if (isList(curve)) {
    if (curve.length !== 4) return null;
    for (let i = 0; i < 4; i++) if (!finite(curve[i])) return null;
    const x1 = curve[0] as number;
    const x2 = curve[2] as number;
    // CSS kabi: x koordinatalar [0, 1] da (y ixtiyoriy — overshoot).
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
    return { kind: "bezier", bezier: [x1, curve[1] as number, x2, curve[3] as number] };
  }
  if (typeof curve === "object" && curve !== null) {
    const raw = curve as { in?: unknown; out?: unknown };
    if (pair(raw.in) && pair(raw.out)) return { kind: "raw", raw: { in: raw.in, out: raw.out } };
  }
  return null;
}

/** Bitta o'lcham uchun `[speed, influence]` (AE influence 0.1–100). */
export interface EaseValue {
  speed: number;
  influence: number;
}

export interface SegmentEase {
  /** A kalitining chiqish ease'i (har o'lcham uchun). */
  out: EaseValue[];
  /** B kalitining kirish ease'i (har o'lcham uchun). */
  in: EaseValue[];
}

function clampInfluence(value: number): number {
  return value < 0.1 ? 0.1 : value > 100 ? 100 : value;
}

/**
 * Bezier segment ease'i. `deltas` — har o'lcham Δv (ishorasi bilan); spatial'da bitta element —
 * yo'l uzunligi (musbat). `color` — tezlik 0. T ≤ 0 bo'lsa tezlik 0.
 */
export function bezierEase(
  bezier: Bezier,
  deltas: readonly number[],
  duration: number,
  color = false,
): SegmentEase {
  const x1 = bezier[0];
  const y1 = bezier[1];
  const x2 = bezier[2];
  const y2 = bezier[3];
  const outInfluence = clampInfluence(x1 * 100);
  const inInfluence = clampInfluence((1 - x2) * 100);
  const result: SegmentEase = { out: [], in: [] };
  for (let i = 0; i < deltas.length; i++) {
    const avg = color || duration <= 0 ? 0 : (deltas[i] as number) / duration;
    result.out.push({ speed: x1 > 0 ? (y1 / x1) * avg : 0, influence: outInfluence });
    result.in.push({ speed: x2 < 1 ? ((1 - y2) / (1 - x2)) * avg : 0, influence: inInfluence });
  }
  return result;
}

/** Xom AE qiymatlari barcha o'lchamlarga bir xil. */
export function rawEase(raw: RawEase, dims: number): SegmentEase {
  const result: SegmentEase = { out: [], in: [] };
  for (let i = 0; i < dims; i++) {
    result.out.push({ speed: raw.out[0], influence: clampInfluence(raw.out[1]) });
    result.in.push({ speed: raw.in[0], influence: clampInfluence(raw.in[1]) });
  }
  return result;
}

/** Qiymatlar farqi: son yoki massiv (o'lcham bo'yicha). */
export function valueDeltas(a: unknown, b: unknown): number[] {
  if (finite(a) && finite(b)) return [b - a];
  const out: number[] = [];
  if (isList(a) && isList(b)) {
    const n = a.length < b.length ? a.length : b.length;
    for (let i = 0; i < n; i++) {
      const av = a[i];
      const bv = b[i];
      out.push(finite(av) && finite(bv) ? bv - av : 0);
    }
  }
  return out;
}

/** Spatial yo'l uzunligi (to'g'ri chiziq). */
export function pathLength(a: unknown, b: unknown): number {
  const deltas = valueDeltas(a, b);
  let sum = 0;
  for (let i = 0; i < deltas.length; i++) sum += (deltas[i] as number) * (deltas[i] as number);
  return Math.sqrt(sum);
}
