/**
 * Effekt alias'lari → matchName va parametr kalitlari (update-technicalguidline §4.6, §11-C).
 * Parametr kaliti: 1-indeks ("3") — lokalizatsiyadan mustaqil, tasdiqlangan effektlar uchun; aks holda
 * inglizcha ko'rinadigan nom. Alias'da yo'q kalit o'zgarishsiz uzatiladi (nom, matchName yoki indeks).
 * Aniq nom/indeks: `fx_params` vositasi.
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";

export interface FxParamAlias {
  key: string;
  /** Spec qiymati → AE ichki shkalasi (masalan foiz 0–100 → 0–255). */
  scale?: number;
  /** Popup qiymatlari: nom → 1-indeks. */
  values?: Record<string, number>;
}

export interface FxAlias {
  matchName: string;
  params: Record<string, FxParamAlias>;
}

const p = (key: string, extra: Omit<FxParamAlias, "key"> = {}): FxParamAlias => ({ key, ...extra });

export const FX_ALIASES: Record<string, FxAlias> = {
  // ------------------------------------------------ blur
  gaussian_blur: {
    matchName: "ADBE Gaussian Blur 2",
    params: {
      blurriness: p("1"),
      dimensions: p("2", { values: { both: 1, horizontal: 2, vertical: 3 } }),
      repeat_edge_pixels: p("3"),
    },
  },
  directional_blur: {
    matchName: "ADBE Motion Blur",
    params: { direction: p("1"), length: p("2") },
  },
  radial_blur: {
    matchName: "ADBE Radial Blur",
    params: {
      amount: p("Amount"),
      center: p("Center"),
      type: p("Type", { values: { spin: 1, zoom: 2 } }),
    },
  },
  fast_box_blur: {
    matchName: "ADBE Box Blur2",
    params: { radius: p("Blur Radius"), iterations: p("Iterations") },
  },
  camera_lens_blur: {
    matchName: "ADBE Camera Lens Blur",
    params: { radius: p("Blur Radius") },
  },
  cc_radial_fast_blur: {
    matchName: "CC Radial Fast Blur",
    params: { center: p("Center"), amount: p("Amount"), zoom: p("Zoom") },
  },
  // ------------------------------------------------ stylize / light
  drop_shadow: {
    matchName: "ADBE Drop Shadow",
    params: {
      color: p("1"),
      opacity: p("2", { scale: 2.55 }),
      direction: p("3"),
      distance: p("4"),
      softness: p("5"),
      shadow_only: p("6"),
    },
  },
  glow: {
    matchName: "ADBE Glo2",
    params: {
      threshold: p("2"),
      radius: p("3"),
      intensity: p("4"),
      colors: p("7", { values: { original: 1, a_b: 2 } }),
      color_a: p("12"),
      color_b: p("13"),
    },
  },
  light_sweep: {
    matchName: "CC Light Sweep",
    params: {
      center: p("Center"),
      direction: p("Direction"),
      width: p("Width"),
      intensity: p("Sweep Intensity"),
      edge_intensity: p("Edge Intensity"),
      edge_thickness: p("Edge Thickness"),
      color: p("Light Color"),
    },
  },
  echo: {
    matchName: "ADBE Echo",
    params: {
      time: p("Echo Time (seconds)"),
      count: p("Number Of Echoes"),
      intensity: p("Starting Intensity"),
      decay: p("Decay"),
    },
  },
  // ------------------------------------------------ color / generate
  fill: { matchName: "ADBE Fill", params: { color: p("3") } },
  tint: {
    matchName: "ADBE Tint",
    params: { black: p("1"), white: p("2"), amount: p("3") },
  },
  gradient_ramp: {
    matchName: "ADBE Ramp",
    params: {
      start: p("1"),
      start_color: p("2"),
      end: p("3"),
      end_color: p("4"),
      shape: p("5", { values: { linear: 1, radial: 2 } }),
      scatter: p("6"),
      blend: p("7"),
    },
  },
  /** Mesh gradient: 4 nuqta va 4 rangli yumshoq fon. */
  four_color_gradient: {
    matchName: "ADBE 4ColorGradient",
    params: {
      point1: p("Point 1"),
      color1: p("Color 1"),
      point2: p("Point 2"),
      color2: p("Color 2"),
      point3: p("Point 3"),
      color3: p("Color 3"),
      point4: p("Point 4"),
      color4: p("Color 4"),
      blend: p("Blend"),
      jitter: p("Jitter"),
    },
  },
  fractal_noise: {
    matchName: "ADBE Fractal Noise",
    params: {
      contrast: p("Contrast"),
      brightness: p("Brightness"),
      complexity: p("Complexity"),
      evolution: p("Evolution"),
      invert: p("Invert"),
    },
  },
  noise: { matchName: "ADBE Noise", params: { amount: p("1") } },
  hue_saturation: {
    matchName: "ADBE HUE SATURATION",
    params: {
      hue: p("Master Hue"),
      saturation: p("Master Saturation"),
      lightness: p("Master Lightness"),
      colorize: p("Colorize"),
    },
  },
  brightness_contrast: {
    matchName: "ADBE Brightness & Contrast 2",
    params: { brightness: p("1"), contrast: p("2") },
  },
  exposure: {
    matchName: "ADBE Exposure2",
    params: { exposure: p("Exposure"), offset: p("Offset"), gamma: p("Gamma Correction") },
  },
  // ------------------------------------------------ transitions
  linear_wipe: {
    matchName: "ADBE Linear Wipe",
    params: { completion: p("1"), angle: p("2"), feather: p("3") },
  },
  radial_wipe: {
    matchName: "ADBE Radial Wipe",
    params: {
      completion: p("1"),
      start_angle: p("2"),
      center: p("Wipe Center"),
      wipe: p("Wipe", { values: { clockwise: 1, counterclockwise: 2, both: 3 } }),
      feather: p("Feather"),
    },
  },
  venetian_blinds: {
    matchName: "ADBE Venetian Blinds",
    params: { completion: p("1"), direction: p("2"), width: p("3"), feather: p("4") },
  },
  // ------------------------------------------------ mesh / deformatsiya
  bezier_warp: {
    matchName: "ADBE BEZMESH",
    params: {
      top_left: p("1"),
      top_left_tangent: p("2"),
      top_right_tangent: p("3"),
      top_right: p("4"),
      right_top_tangent: p("5"),
      right_bottom_tangent: p("6"),
      bottom_right: p("7"),
      bottom_right_tangent: p("8"),
      bottom_left_tangent: p("9"),
      bottom_left: p("10"),
      left_bottom_tangent: p("11"),
      left_top_tangent: p("12"),
      quality: p("13"),
    },
  },
  corner_pin: {
    matchName: "ADBE Corner Pin",
    params: { upper_left: p("1"), upper_right: p("2"), lower_left: p("3"), lower_right: p("4") },
  },
  wave_warp: {
    matchName: "ADBE Wave Warp",
    params: {
      wave_type: p("Wave Type", {
        values: {
          sine: 1,
          square: 2,
          triangle: 3,
          sawtooth: 4,
          circle: 5,
          semicircle: 6,
          noise: 8,
        },
      }),
      height: p("Wave Height"),
      width: p("Wave Width"),
      direction: p("Direction"),
      speed: p("Wave Speed"),
      phase: p("Phase"),
    },
  },
  turbulent_displace: {
    matchName: "ADBE Turbulent Displace",
    params: {
      amount: p("Amount"),
      size: p("Size"),
      complexity: p("Complexity"),
      evolution: p("Evolution"),
    },
  },
  bulge: {
    matchName: "ADBE Bulge",
    params: {
      horizontal_radius: p("Horizontal Radius"),
      vertical_radius: p("Vertical Radius"),
      center: p("Bulge Center"),
      height: p("Bulge Height"),
    },
  },
  twirl: {
    matchName: "ADBE Twirl",
    params: { angle: p("Angle"), radius: p("Twirl Radius"), center: p("Twirl Center") },
  },
  spherize: {
    matchName: "ADBE Spherize",
    params: { radius: p("Radius"), center: p("Center of Sphere") },
  },
  cc_bend_it: {
    matchName: "CC Bend It",
    params: { bend: p("Bend"), start: p("Start"), end: p("End") },
  },
  // ------------------------------------------------ boshqa
  transform: {
    matchName: "ADBE Geometry2",
    params: {
      anchor: p("Anchor Point"),
      position: p("Position"),
      rotation: p("Rotation"),
      opacity: p("Opacity"),
      skew: p("Skew"),
      skew_axis: p("Skew Axis"),
    },
  },
  set_matte: { matchName: "ADBE Set Matte3", params: {} },
  slider: { matchName: "ADBE Slider Control", params: { value: p("1") } },
  color_ctrl: { matchName: "ADBE Color Control", params: { value: p("1") } },
  point_ctrl: { matchName: "ADBE Point Control", params: { value: p("1") } },
  checkbox: { matchName: "ADBE Checkbox Control", params: { value: p("1") } },
  angle: { matchName: "ADBE Angle Control", params: { value: p("1") } },
};

export function fxMatchName(fx: string): string {
  return FX_ALIASES[fx]?.matchName ?? fx;
}

type FxValue = number | number[] | boolean | string;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Spec parametri → op kaliti va qiymati (alias, shkala, popup nomi). */
export function mapFxParam(
  fx: string,
  key: string,
  value: FxValue,
): Result<{ key: string; value: FxValue }> {
  const alias = FX_ALIASES[fx]?.params[key];
  if (alias === undefined) return ok({ key, value });
  if (typeof value === "string" && !HEX_RE.test(value)) {
    const mapped = alias.values?.[value];
    if (mapped === undefined) {
      const allowed = alias.values === undefined ? "son" : Object.keys(alias.values).join(", ");
      return fail("FX_PARAM_UNKNOWN", `${fx}.${key}: '${value}' noma'lum (ruxsat: ${allowed})`);
    }
    return ok({ key: alias.key, value: mapped });
  }
  if (alias.scale !== undefined && typeof value === "number") {
    return ok({ key: alias.key, value: Math.round(value * alias.scale * 1000) / 1000 });
  }
  return ok({ key: alias.key, value });
}

/** Keyframe yo'li uchun parametr kaliti (qiymatsiz). */
export function fxParamKey(fx: string, key: string): { key: string; scale?: number } {
  const alias = FX_ALIASES[fx]?.params[key];
  if (alias === undefined) return { key };
  return alias.scale === undefined ? { key: alias.key } : { key: alias.key, scale: alias.scale };
}
