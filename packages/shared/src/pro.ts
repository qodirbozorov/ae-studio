/**
 * Professional qatlam maydonlari (Faza 7, update-technicalguidline §4.2–4.7): keyframe'lar, transform,
 * effektlar, maskalar, matte, blend, parent va shape contents. v1 spec'ga qo'shimcha.
 * Qiymatlar AE birliklarida: piksel, foiz (scale, opacity), gradus (rotation), rang `#RRGGBB`.
 */
import { z } from "zod";
import { hexColorSchema, slugSchema } from "./common";
import { easeCurveSchema } from "./ops";

const num = z.number().min(-1_000_000).max(1_000_000);
const pct = z.number().min(0).max(100);
export const vec2Schema = z.tuple([num, num]);
const vec3Schema = z.tuple([num, num, num]);
const vec23Schema = z.union([vec2Schema, vec3Schema]);

/** Keyframe qiymati: son, vektor yoki rang (`#RRGGBB` — rang xususiyatlarida). */
export const propValueSchema = z.union([num, z.array(num).min(1).max(4), hexColorSchema]);

/**
 * Xususiyat yo'li: `position`, `scale`, `rotation`, `opacity`, `anchor`, `position.x|y`, `rotation_x|y`,
 * `orientation`, `contents.<id>.<prop>`, `effects.<id>.<param>`, `masks.<id>.feather|expansion|opacity`.
 */
export const PRO_PATH_RE = /^[a-z][a-z0-9_]*(\.[^.]{1,128}){0,4}$/;

export const proKeySchema = z.strictObject({
  t: z.number().min(0).max(3600).describe("Seconds from the layer start"),
  v: propValueSchema,
  ease: easeCurveSchema
    .optional()
    .describe(
      "Segment ease (previous key → this key): enter|exit|move|soft|pop, CSS cubic-bezier [x1,y1,x2,y2], linear, hold, or raw {in:[speed,influence], out:[...]}. Default linear",
    ),
});

const keyListSchema = z.array(proKeySchema).min(1).max(300);

export const keyframesSchema = z
  .record(z.string().regex(PRO_PATH_RE, { error: "Noto'g'ri xususiyat yo'li" }), keyListSchema)
  .describe(
    "Keyframes by property path. Layer: position, position.x, position.y, anchor, scale, rotation, opacity, rotation_x, rotation_y, orientation. Shape: contents.<id>.size|position|roundness|points|outer_radius|inner_radius|fill.color|fill.opacity|stroke.color|stroke.width|stroke.opacity|trim.start|trim.end|trim.offset|round_corners|repeater.copies|repeater.offset|transform.position|transform.scale|transform.rotation|transform.opacity. Effect: effects.<id>.<param>. Mask: masks.<id>.feather|expansion|opacity. Values in AE units (px, %, degrees, #hex)",
  );

export const transformSchema = z
  .strictObject({
    anchor: vec23Schema.optional(),
    position: vec23Schema.optional(),
    scale: z.union([num, vec23Schema]).optional(),
    rotation: num.optional(),
    opacity: pct.optional(),
    rotation_x: num.optional(),
    rotation_y: num.optional(),
    orientation: vec3Schema.optional(),
  })
  .describe(
    "Static AE transform in AE units: position/anchor px (composition space), scale %, rotation degrees. Overrides pos/opacity",
  );

const fxValueSchema = z.union([num, z.array(num).min(1).max(4), z.boolean(), z.string().max(200)]);

export const effectSchema = z
  .strictObject({
    id: slugSchema.optional().describe("Used in keyframes paths: effects.<id>.<param>"),
    fx: z
      .string()
      .min(1)
      .max(128)
      .describe(
        "Alias (gaussian_blur, drop_shadow, glow, gradient_ramp, four_color_gradient, bezier_warp, wave_warp, turbulent_displace …) or any installed effect matchName (ae_effects)",
      ),
    params: z
      .record(z.string().min(1).max(128), fxValueSchema)
      .optional()
      .describe(
        'Param alias, display name, matchName or 1-based index ("3") → value. Colors #hex, points [x,y] in layer px, percentages 0–100. Exact names: fx_params',
      ),
    keyframes: z.record(z.string().min(1).max(128), keyListSchema).optional(),
    enabled: z.boolean().optional(),
  })
  .describe("Effect on the layer (applied in order)");

const rect4Schema = z.tuple([num, num, z.number().positive(), z.number().positive()]);

export const pathDataSchema = z.strictObject({
  points: z.array(vec2Schema).min(2).max(2000),
  /** Kiruvchi tangentlar (nuqtaga nisbatan). */
  in: z.array(vec2Schema).max(2000).optional(),
  /** Chiquvchi tangentlar (nuqtaga nisbatan). */
  out: z.array(vec2Schema).max(2000).optional(),
  closed: z.boolean().optional(),
});

export const MASK_MODES = [
  "add",
  "subtract",
  "intersect",
  "lighten",
  "darken",
  "difference",
  "none",
] as const;

export const maskSchema = z
  .strictObject({
    id: slugSchema.optional(),
    rect: rect4Schema.optional().describe("[x, y, w, h] in layer px"),
    ellipse: rect4Schema.optional().describe("[x, y, w, h] in layer px"),
    roundness: z.number().min(0).max(10_000).optional().describe("rect corner radius"),
    path: pathDataSchema.optional(),
    svg_d: z.string().min(1).max(20_000).optional(),
    mode: z.enum(MASK_MODES).optional(),
    feather: z.union([z.number().min(0).max(10_000), vec2Schema]).optional(),
    expansion: num.optional(),
    opacity: pct.optional(),
    inverted: z.boolean().optional(),
    keyframes: z.record(z.enum(["feather", "expansion", "opacity"]), keyListSchema).optional(),
  })
  .describe(
    "Layer mask in the layer's own coordinates (media/solid: source pixels, top-left 0,0; shape/text: layer origin 0,0). One of rect, ellipse, path, svg_d",
  );

export const MATTE_TYPES = ["alpha", "alpha_inverted", "luma", "luma_inverted"] as const;

export const matteSchema = z
  .strictObject({
    source: slugSchema.describe("Layer id in the same scene; its video is turned off"),
    type: z.enum(MATTE_TYPES).optional(),
  })
  .describe("Track matte (AE 23+ setTrackMatte; older AE: legacy matte, source moved above)");

export const BLEND_MODES = [
  "normal",
  "add",
  "screen",
  "multiply",
  "overlay",
  "soft_light",
  "hard_light",
  "color_dodge",
  "color_burn",
  "darken",
  "lighten",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "linear_light",
  "vivid_light",
  "pin_light",
  "hard_mix",
  "linear_burn",
  "lighter_color",
  "darker_color",
  "subtract",
  "divide",
  "stencil_alpha",
  "stencil_luma",
  "silhouette_alpha",
  "silhouette_luma",
] as const;

/** Barcha ko'rinadigan qatlamlarga qo'shiladigan maydonlar. */
export const proLayerFields = {
  transform: transformSchema.optional(),
  keyframes: keyframesSchema.optional(),
  effects: z.array(effectSchema).max(30).optional(),
  masks: z.array(maskSchema).max(16).optional(),
  matte: matteSchema.optional(),
  blend: z.enum(BLEND_MODES).optional(),
  parent: slugSchema.optional().describe("Layer id in the same scene (AE parenting)"),
  three_d: z.boolean().optional(),
  motion_blur: z.boolean().optional(),
};

// ---------------------------------------------------------------- shape contents (§4.4)

export const gradientSchema = z
  .strictObject({
    type: z.enum(["linear", "radial"]).optional(),
    colors: z.tuple([hexColorSchema, hexColorSchema]),
    start: vec2Schema,
    end: vec2Schema,
  })
  .describe(
    "2-color gradient, start/end in shape px. Applied with a layer-level Tint, so a shape layer with a gradient must not mix other solid colors",
  );

const paintFields = {
  color: hexColorSchema.optional(),
  gradient: gradientSchema.optional(),
  opacity: pct.optional(),
};

export const fillSchema = z.strictObject({
  ...paintFields,
  rule: z.enum(["nonzero", "evenodd"]).optional(),
});

export const strokeSchema = z.strictObject({
  ...paintFields,
  width: z.number().min(0).max(10_000),
  cap: z.enum(["butt", "round", "square"]).optional(),
  join: z.enum(["miter", "round", "bevel"]).optional(),
  miter_limit: z.number().min(1).max(100).optional(),
  dashes: z.array(z.number().min(0).max(10_000)).min(1).max(6).optional(),
  dash_offset: num.optional(),
});

export const shapeTransformSchema = z.strictObject({
  anchor: vec2Schema.optional(),
  position: vec2Schema.optional(),
  scale: vec2Schema.optional(),
  rotation: num.optional(),
  opacity: pct.optional(),
  skew: num.optional(),
  skew_axis: num.optional(),
});

export const SHAPE_KINDS = ["rect", "ellipse", "star", "polygon", "path", "group"] as const;

export const shapeContentSchema = z
  .strictObject({
    id: slugSchema.optional().describe("Used in keyframes paths: contents.<id>.<prop>"),
    kind: z.enum(SHAPE_KINDS),
    size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    position: vec2Schema.optional().describe("px relative to the layer origin (pos)"),
    roundness: z.number().min(0).max(10_000).optional(),
    points: z.number().int().min(3).max(100).optional().describe("star/polygon vertex count"),
    outer_radius: z.number().positive().optional(),
    inner_radius: z.number().positive().optional(),
    outer_roundness: z.number().min(-1000).max(1000).optional(),
    inner_roundness: z.number().min(-1000).max(1000).optional(),
    rotation: num.optional().describe("star/polygon rotation"),
    path: pathDataSchema.optional(),
    svg_d: z
      .string()
      .min(1)
      .max(20_000)
      .optional()
      .describe("SVG path data (M, L, H, V, C, S, Q, T, A, Z)"),
    fit: z
      .tuple([z.number().positive(), z.number().positive()])
      .optional()
      .describe("path/svg_d: scale and center the path into [w, h]"),
    fill: fillSchema.optional(),
    stroke: strokeSchema.optional(),
    trim: z
      .strictObject({
        start: pct.optional(),
        end: pct.optional(),
        offset: num.optional(),
        individually: z.boolean().optional(),
      })
      .optional(),
    round_corners: z.number().min(0).max(10_000).optional(),
    offset_paths: z
      .strictObject({ amount: num, join: z.enum(["miter", "round", "bevel"]).optional() })
      .optional(),
    merge: z.enum(["merge", "add", "subtract", "intersect", "exclude"]).optional(),
    zig_zag: z
      .strictObject({
        size: num,
        ridges: z.number().min(0).max(100).optional(),
        smooth: z.boolean().optional(),
      })
      .optional(),
    pucker_bloat: z.number().min(-100).max(100).optional(),
    twist: z.strictObject({ angle: num, center: vec2Schema.optional() }).optional(),
    wiggle: z
      .strictObject({
        size: num,
        detail: z.number().min(0).max(100).optional(),
        speed: z.number().min(0).max(100).optional(),
        seed: z.number().int().min(0).max(10_000).optional(),
      })
      .optional(),
    repeater: z
      .strictObject({
        copies: z.number().min(0).max(1000),
        offset: num.optional(),
        position: vec2Schema.optional(),
        scale: vec2Schema.optional(),
        rotation: num.optional(),
        start_opacity: pct.optional(),
        end_opacity: pct.optional(),
        composite: z.enum(["above", "below"]).optional(),
      })
      .optional(),
    transform: shapeTransformSchema.optional(),
    get contents() {
      return z.array(shapeContentSchema).max(100).optional();
    },
    keyframes: z
      .record(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/), keyListSchema)
      .optional()
      .describe("Like layer keyframes, relative to this content: size, trim.end, fill.color …"),
  })
  .describe(
    "Shape content (AE vector group). kind: rect{size,roundness} · ellipse{size} · star/polygon{points,outer_radius,inner_radius} · path{path|svg_d,fit} · group{contents}. Stack order: path → modifiers → stroke → fill → repeater",
  );

export type ShapeContentSpec = z.output<typeof shapeContentSchema>;
export type EffectSpec = z.output<typeof effectSchema>;
export type MaskSpec = z.output<typeof maskSchema>;
export type ProKey = z.output<typeof proKeySchema>;
export type BlendMode = (typeof BLEND_MODES)[number];
export type MatteType = (typeof MATTE_TYPES)[number];

/** Kind'ga xos majburiy maydonlar va id'lar (qatlam ichida yagona). Xatolar: [yo'l, xabar]. */
export function checkContents(
  contents: readonly ShapeContentSpec[],
  base: (string | number)[],
  ids: Set<string>,
  out: [(string | number)[], string][],
): void {
  contents.forEach((content, index) => {
    const at = [...base, index];
    if (content.id !== undefined) {
      if (ids.has(content.id)) out.push([[...at, "id"], "contents id takrorlangan: " + content.id]);
      ids.add(content.id);
    }
    const need = (field: keyof ShapeContentSpec, why: string) => {
      if (content[field] === undefined) out.push([[...at, field], why]);
    };
    switch (content.kind) {
      case "rect":
      case "ellipse":
        need("size", `${content.kind} uchun size [w, h] kerak`);
        break;
      case "star":
        need("points", "star uchun points kerak");
        need("outer_radius", "star uchun outer_radius kerak");
        need("inner_radius", "star uchun inner_radius kerak");
        break;
      case "polygon":
        need("points", "polygon uchun points kerak");
        need("outer_radius", "polygon uchun outer_radius kerak");
        break;
      case "path":
        if ((content.path === undefined) === (content.svg_d === undefined)) {
          out.push([[...at, "path"], "path uchun path yoki svg_d (bittasi) kerak"]);
        }
        break;
      case "group":
        if (content.contents === undefined || content.contents.length === 0) {
          out.push([[...at, "contents"], "group uchun contents kerak"]);
        }
        break;
    }
    if (content.kind !== "group" && content.contents !== undefined) {
      out.push([[...at, "contents"], "contents faqat group'da"]);
    }
    for (const paint of ["fill", "stroke"] as const) {
      const value = content[paint];
      if (value !== undefined && (value.color === undefined) === (value.gradient === undefined)) {
        out.push([[...at, paint], `${paint}: color yoki gradient (bittasi) kerak`]);
      }
    }
    if (content.contents !== undefined)
      checkContents(content.contents, [...at, "contents"], ids, out);
  });
}

/** Maska shakli: rect, ellipse, path, svg_d dan aynan bittasi. */
export function maskShapeCount(mask: MaskSpec): number {
  return [mask.rect, mask.ellipse, mask.path, mask.svg_d].filter((v) => v !== undefined).length;
}
