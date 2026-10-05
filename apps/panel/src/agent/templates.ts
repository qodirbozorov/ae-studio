/**
 * Panel Shablonlar ekrani (P5.06): turlar va galereya uchun sxematik ko'rinish (preview.gif bo'lmasa).
 * Sxema manifest retseptidan: media — kulrang to'rtburchak, shape — rangli shakl, matn — slot nomi yoki default.
 */
export type Aspect = "9:16" | "1:1" | "16:9";

export interface TemplateSlotView {
  type: "text" | "media" | "color";
  label: string;
  required: boolean;
  default?: string | number | boolean;
  max_chars?: number;
}

export interface TemplateView {
  slug: string;
  title: string;
  description: string | null;
  source: "recipe" | "aep";
  origin: string;
  version: number;
  formats: Aspect[];
  duration: { min: number; max: number };
  tags: string[];
  slots: Record<string, TemplateSlotView>;
  preview_url: string | null;
  manifest: { layers?: Record<string, unknown>[]; bg?: string };
  example_scene: { dur: number };
}

export interface TemplateRunInput {
  project_id: string;
  slots: Record<string, string>;
  format?: Aspect;
  variants?: Aspect[];
  dur?: number;
  output_name?: string;
}

export interface SketchItem {
  kind: "media" | "rect" | "ellipse" | "text";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  opacity: number;
  text?: string;
}

const DEFAULT_TOKENS: Record<string, string> = {
  "brand.primary": "#FFCC00",
  "brand.secondary": "#FFFFFF",
  "brand.accent": "#FFCC00",
  "brand.text": "#FFFFFF",
  "brand.background": "#000000",
};

const POSITIONS: Record<string, [number, number]> = {
  center: [0.5, 0.5],
  top: [0.5, 0.12],
  bottom: [0.5, 0.88],
  upper_third: [0.5, 1 / 3],
  lower_third: [0.5, 0.78],
  top_left: [0.1, 0.1],
  top_right: [0.9, 0.1],
  bottom_left: [0.1, 0.9],
  bottom_right: [0.9, 0.9],
};

export function aspectSize(aspect: Aspect, width = 90): { w: number; h: number } {
  if (aspect === "9:16") return { w: width, h: Math.round((width * 16) / 9) };
  if (aspect === "16:9") return { w: width, h: Math.round((width * 9) / 16) };
  return { w: width, h: width };
}

function color(value: unknown, slots: Record<string, TemplateSlotView>): string {
  if (typeof value !== "string") return "#888888";
  const token = /^\{\{([a-z0-9_.]+)\}\}$/.exec(value);
  if (token === null) return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#888888";
  const name = token[1]!;
  const slot = slots[name];
  if (slot !== undefined) return color(slot.default, {});
  return DEFAULT_TOKENS[name] ?? "#888888";
}

function label(value: unknown, slots: Record<string, TemplateSlotView>): string {
  if (typeof value !== "string") return "";
  return value.replace(/\{\{([a-z0-9_]+)\}\}/g, (_m, name: string) => {
    const slot = slots[name];
    const fallback = slot?.default;
    return typeof fallback === "string" && fallback !== "" ? fallback : (slot?.label ?? name);
  });
}

/** Manifest retseptidan sxema elementlari (0–1 nisbiy koordinatalar, markaz bo'yicha). */
export function sketchItems(template: TemplateView): SketchItem[] {
  const out: SketchItem[] = [];
  for (const raw of template.manifest.layers ?? []) {
    const layer = raw as Record<string, unknown>;
    const pos = layer.pos;
    const [x, y] =
      typeof pos === "string"
        ? (POSITIONS[pos] ?? [0.5, 0.5])
        : pos !== null && typeof pos === "object"
          ? [Number((pos as { x: number }).x), Number((pos as { y: number }).y)]
          : [0.5, 0.5];
    const opacity = typeof layer.opacity === "number" ? layer.opacity / 100 : 1;
    if (layer.type === "media") {
      const scale = typeof layer.scale === "number" ? layer.scale : 1;
      out.push({ kind: "media", x, y, w: scale, h: scale, color: "#555555", opacity });
    } else if (layer.type === "shape") {
      const size = layer.size as { w: number; h: number } | undefined;
      out.push({
        kind: layer.kind === "ellipse" ? "ellipse" : "rect",
        x,
        y,
        w: size?.w ?? 0.2,
        h: size?.h ?? 0.1,
        color: color(layer.color, template.slots),
        opacity,
      });
    } else if (layer.type === "text") {
      const style = (layer.style ?? {}) as { color?: unknown; size?: number };
      out.push({
        kind: "text",
        x,
        y,
        w: typeof layer.max_width === "number" ? layer.max_width : 0.9,
        h: (style.size ?? 80) / 1920,
        color: color(style.color ?? "#FFFFFF", template.slots),
        opacity,
        text: label(layer.text, template.slots),
      });
    }
  }
  return out;
}

/** Forma qiymatlari tekshiruvi: majburiy slotlar va matn chegarasi. Xato bo'lsa matn qaytaradi. */
export function validateSlots(
  template: TemplateView,
  values: Record<string, string>,
): string | null {
  for (const [name, slot] of Object.entries(template.slots)) {
    const value = (values[name] ?? "").trim();
    if (slot.required && value === "") return `${slot.label}: to'ldiring`;
    if (slot.type === "text" && slot.max_chars !== undefined && value.length > slot.max_chars) {
      return `${slot.label}: ${value.length}/${slot.max_chars} belgi`;
    }
    if (slot.type === "color" && value !== "" && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
      return `${slot.label}: rang #RRGGBB bo'lishi kerak`;
    }
  }
  return null;
}

/** Bo'sh ixtiyoriy slotlar yuborilmaydi (shablon default'i ishlaydi). */
export function slotPayload(
  template: TemplateView,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(template.slots)) {
    const value = (values[name] ?? "").trim();
    if (value !== "") out[name] = value;
  }
  return out;
}
