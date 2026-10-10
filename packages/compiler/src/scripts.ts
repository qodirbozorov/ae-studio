/**
 * Gibrid usul: kutubxona snippetlari (ES3, AES prelude bilan, `args` orqali) va expression shablonlari.
 * Snippetlar `jsx.run` op'ida bajariladi: `function (AES, args, ctx) { <code> }`.
 * Qatlam: `args.__ref` (kompilyator bergan op ref) yoki `args.__comp` + `args.layer` (comp ichidagi nom).
 */
import { fail, ok, scriptDanger } from "@aes/shared";
import type { OpParamsMap, Result } from "@aes/shared";

export interface ScriptLibEntry {
  description: string;
  /** Argumentlar: nom → "tur — izoh". */
  args: Record<string, string>;
  code: string;
  /** Expression shablonini kompilyatorda yoyib `args.code` ga qo'yadi. */
  expression?: string;
}

const SET_EXPRESSION = [
  "var layer = AES.target(args);",
  "var prop = AES.prop(layer, args.prop);",
  "prop.expression = args.code;",
  'if (prop.expressionError) throw new Error("Expression xatosi: " + prop.expressionError);',
  "return { prop: args.prop };",
].join("\n");

export const SCRIPT_LIB: Record<string, ScriptLibEntry> = {
  apply_preset: {
    description: "Animation preset (.ffx) by name at a time (seconds from the layer start)",
    args: { layer: "string — layer id", name: "string — preset name", at: "number — seconds" },
    code: [
      "var layer = AES.target(args);",
      "AES.preset(layer, args.name, layer.inPoint + (args.at || 0));",
      "return { applied: args.name };",
    ].join("\n"),
  },
  counter: {
    description: "Counts a text layer from → to (slider + Source Text expression)",
    args: {
      layer: "string — text layer id",
      from: "number",
      to: "number",
      dur: "number — seconds (default 1)",
      at: "number — seconds from layer start",
      decimals: "number (default 0)",
      separator: 'string — thousands separator (default " ")',
      prefix: "string",
      suffix: 'string (e.g. "%")',
    },
    code: [
      "var layer = AES.target(args);",
      'var slider = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");',
      'slider.name = "AES Count";',
      "var t0 = layer.inPoint + (args.at || 0);",
      'AES.anim(slider.property(1), [[t0, 0], [t0 + (args.dur || 1), 1, "enter"]], "linear");',
      "var dec = args.decimals || 0;",
      "var from = args.from || 0;",
      'var sep = args.separator === undefined ? " " : String(args.separator);',
      "var expr = 'var t = effect(\"AES Count\")(1).value;\\n' +",
      "  'var v = ' + from + ' + (' + args.to + ' - ' + from + ') * t;\\n' +",
      "  'var s = Math.abs(v).toFixed(' + dec + ').split(\".\");\\n' +",
      "  'var i = s[0], o = \"\";\\n' +",
      "  'while (i.length > 3) { o = ' + JSON.stringify(sep) + ' + i.slice(-3) + o; i = i.slice(0, -3); }\\n' +",
      '  \'(v < 0 ? "-" : "") + \' + JSON.stringify(args.prefix || "") + \' + i + o + (s.length > 1 ? "." + s[1] : "") + \' + JSON.stringify(args.suffix || "");',
      'var doc = layer.property("ADBE Text Properties").property("ADBE Text Document");',
      "doc.expression = expr;",
      'if (doc.expressionError) throw new Error("Expression xatosi: " + doc.expressionError);',
      "return { counter: true };",
    ].join("\n"),
  },
  text_words: {
    description:
      "Text animator: chars/words/lines appear one by one (fade_up, word_bounce, blur_in, pop_in)",
    args: {
      layer: "string — text layer id",
      by: "chars | words | lines",
      preset: "fade_up | word_bounce | blur_in | pop_in",
      stagger: "number — seconds between units",
      at: "number — seconds from layer start",
      dur: "number — each unit's length",
    },
    code: [
      "var layer = AES.target(args);",
      "var preset = args.preset || 'fade_up';",
      "var anim = layer.property('ADBE Text Properties').property('ADBE Text Animators').addProperty('ADBE Text Animator');",
      "anim.name = 'AES ' + preset;",
      "var props = anim.property('ADBE Text Animator Properties');",
      "props.addProperty('ADBE Text Opacity').setValue(0);",
      "if (preset === 'fade_up' || preset === 'word_bounce') {",
      "  props.addProperty('ADBE Text Position 3D').setValue([0, preset === 'word_bounce' ? 60 : 40, 0]);",
      "}",
      "if (preset === 'blur_in') props.addProperty('ADBE Text Blur').setValue([12, 12]);",
      "if (preset === 'pop_in' || preset === 'word_bounce') {",
      "  var s = preset === 'pop_in' ? 60 : 85;",
      "  props.addProperty('ADBE Text Scale 3D').setValue([s, s, 100]);",
      "}",
      "var by = args.by === 'chars' ? 1 : 3;",
      "if (args.by === 'lines') by = 4;",
      "var sel = anim.property('ADBE Text Selectors').addProperty('ADBE Text Expressible Selector');",
      "sel.property('ADBE Text Range Type2').setValue(by);",
      "var ease = preset === 'word_bounce' || preset === 'pop_in'",
      "  ? 'var c = 2.5; var e = 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);'",
      "  : 'var e = 1 - Math.pow(1 - p, 3);';",
      "sel.property('ADBE Text Expressible Amount').expression =",
      "  'var p = (time - inPoint - ' + (args.at || 0) + ' - (textIndex - 1) * ' + (args.stagger || 0.08) + ') / ' + (args.dur || 0.4) + ';\\n' +",
      "  'p = Math.min(Math.max(p, 0), 1);\\n' + ease + '\\n100 * (1 - e)';",
      "return { animator: anim.name };",
    ].join("\n"),
  },
  inertial_bounce: {
    description: "Inertial bounce after the last keyframe (scale/position/rotation)",
    args: {
      layer: "string — layer id",
      prop: 'string (default "scale")',
      amp: "number",
      freq: "number",
      decay: "number",
    },
    code: SET_EXPRESSION,
    expression: "inertial_bounce",
  },
  float_idle: {
    description: "Gentle floating (sine) on a property",
    args: {
      layer: "string — layer id",
      prop: 'string (default "position")',
      amp: "number px",
      speed: "number Hz",
    },
    code: SET_EXPRESSION,
    expression: "float_idle",
  },
  set_expression: {
    description: "Any expression on any property path",
    args: {
      layer: "string — layer id",
      prop: "string — property path",
      code: "string — AE expression",
    },
    code: SET_EXPRESSION,
  },
};

type ExprArg = number | string;

const EXPRESSIONS: Record<
  string,
  { params: [string, ExprArg][]; build: (a: ExprArg[]) => string }
> = {
  inertial_bounce: {
    params: [
      ["amp", 0.05],
      ["freq", 4],
      ["decay", 8],
    ],
    build: ([amp, freq, decay]) =>
      [
        `var amp = ${amp}, freq = ${freq}, decay = ${decay};`,
        "var n = 0;",
        "if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }",
        "var t = n > 0 ? time - key(n).time : 0;",
        "if (n > 0 && t < 1) {",
        "  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);",
        "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
        "} else { value; }",
      ].join("\n"),
  },
  float_idle: {
    params: [
      ["amp", 8],
      ["speed", 0.5],
    ],
    build: ([amp, speed]) =>
      `var o = Math.sin(time * 2 * Math.PI * ${speed}) * ${amp};\nvalue instanceof Array ? value + [0, o] : value + o;`,
  },
  wiggle: {
    params: [
      ["freq", 2],
      ["amp", 20],
    ],
    build: ([freq, amp]) => `wiggle(${freq}, ${amp})`,
  },
  loop_out: {
    params: [["type", "cycle"]],
    build: ([type]) => `loopOut(${JSON.stringify(String(type))})`,
  },
};

export const EXPRESSION_LIB = Object.keys(EXPRESSIONS);

function expression(name: string, values: (ExprArg | undefined)[]): Result<string> {
  const def = EXPRESSIONS[name];
  if (def === undefined) {
    return fail("SPEC_INVALID", `Noma'lum expression: ${name} (bor: ${EXPRESSION_LIB.join(", ")})`);
  }
  const args = def.params.map(([, fallback], i) => {
    const value = values[i] ?? fallback;
    return typeof fallback === "number" && typeof value !== "number" ? Number.NaN : value;
  });
  if (args.some((v) => typeof v === "number" && !Number.isFinite(v))) {
    return fail("SPEC_INVALID", `${name}: argumentlar son bo'lishi kerak`);
  }
  return ok(def.build(args));
}

/** `lib:inertial_bounce(0.05, 4, 8)` → expression matni; oddiy matn o'zgarishsiz. */
export function expandExpression(value: string): Result<string> {
  const match = /^lib:([a-z_]+)\s*(?:\((.*)\))?\s*$/s.exec(value.trim());
  if (match === null) return ok(value);
  const raw = (match[2] ?? "").trim();
  const values: ExprArg[] =
    raw === ""
      ? []
      : raw.split(",").map((part) => {
          const text = part.trim().replace(/^["']|["']$/g, "");
          const n = Number(text);
          return text !== "" && Number.isFinite(n) ? n : text;
        });
  return expression(match[1]!, values);
}

/** Spec skripti yoki `ae_run_jsx` → `jsx.run` parametrlari. */
export function scriptParams(
  input: {
    lib?: string | undefined;
    code?: string | undefined;
    args?: Record<string, unknown> | undefined;
  },
  extra: Record<string, unknown> = {},
  once = true,
): Result<OpParamsMap["jsx.run"]> {
  const args: Record<string, unknown> = { ...(input.args ?? {}), ...extra };
  if (input.lib !== undefined) {
    const entry = SCRIPT_LIB[input.lib];
    if (entry === undefined) {
      return fail(
        "SPEC_INVALID",
        `Noma'lum snippet: ${input.lib} (bor: ${Object.keys(SCRIPT_LIB).join(", ")})`,
      );
    }
    if (entry.expression !== undefined) {
      if (args.prop === undefined)
        args.prop = entry.expression === "float_idle" ? "position" : "scale";
      const def = EXPRESSIONS[entry.expression]!;
      const built = expression(
        entry.expression,
        def.params.map(([param]) => args[param] as ExprArg | undefined),
      );
      if (!built.ok) return built;
      args.code = built.data;
    }
    return ok({ code: entry.code, args, once, label: `lib:${input.lib}` });
  }
  const code = input.code ?? "";
  const danger = scriptDanger(code);
  if (danger !== null) return fail("SCRIPT_UNSAFE", `Skriptda taqiqlangan chaqiruv: ${danger}`);
  return ok({ code, args, raw: true, once, label: "code" });
}
