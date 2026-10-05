/**
 * Expression kutubxonasi (§10.1 `prop.expression`: faqat kutubxonadan, §11.4.4).
 * Argumentlar faqat son yoki ruxsat etilgan qiymat — ixtiyoriy kod kiritib bo'lmaydi.
 */
import type { ScalarValue } from "@aes/shared/ae";
import { raise } from "./util";

type Args = { [name: string]: ScalarValue } | undefined;

function num(args: Args, name: string, fallback: number, min: number, max: number): number {
  const value = args === undefined ? undefined : args[name];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !isFinite(value) || value < min || value > max) {
    return raise("AE_BAD_PARAMS", "Expression argumenti noto'g'ri: " + name);
  }
  return value;
}

function choice(args: Args, name: string, allowed: string[], fallback: string): string {
  const value = args === undefined ? undefined : args[name];
  if (value === undefined) return fallback;
  for (let i = 0; i < allowed.length; i++) if (allowed[i] === value) return value;
  return raise("AE_BAD_PARAMS", "Expression argumenti noto'g'ri: " + name);
}

const BUILDERS: { [id: string]: ((args: Args) => string) | undefined } = {
  /** Tasodifiy tebranish: freq (Hz), amp (piksel/birlik). */
  wiggle: (args) =>
    "wiggle(" + num(args, "freq", 2, 0, 100) + ", " + num(args, "amp", 20, 0, 10000) + ")",
  /** Keyframe'larni takrorlash. */
  loop_out: (args) =>
    'loopOut("' + choice(args, "type", ["cycle", "pingpong", "offset", "continue"], "cycle") + '")',
  /** Oxirgi keyframe'dan keyin inersiya bilan sakrash. */
  bounce: (args) =>
    [
      "var amp = " + num(args, "amp", 0.05, 0, 10) + ";",
      "var freq = " + num(args, "freq", 2, 0, 50) + ";",
      "var decay = " + num(args, "decay", 4, 0, 50) + ";",
      "var n = 0;",
      "if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }",
      "if (n > 0) {",
      "  var t = time - key(n).time;",
      "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
      "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
      "} else { value; }",
    ].join("\n"),
  /** Masshtab pulsatsiyasi (2D/3D scale uchun). */
  pulse: (args) =>
    [
      "var s = " +
        num(args, "amp", 5, 0, 1000) +
        " * Math.sin(time * " +
        num(args, "freq", 1, 0, 50) +
        " * 2 * Math.PI);",
      "var r = []; for (var i = 0; i < value.length; i++) r.push(value[i] + s); r;",
    ].join("\n"),
};

/** Kutubxonadagi id'lar (compiler va testlar shu ro'yxat bilan solishtiradi). */
export const EXPRESSION_IDS = ["wiggle", "loop_out", "bounce", "pulse"];

export function buildExpression(id: string, args: Args): string {
  const builder = BUILDERS[id];
  if (builder === undefined) return raise("AE_BAD_PARAMS", "Kutubxonada yo'q expression: " + id);
  return builder(args);
}
