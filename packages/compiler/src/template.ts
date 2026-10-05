/**
 * Shablonli sahnalar (§11.2): `scene.template` + `slots` → layerlar (recipe) yoki `template.instantiate` (aep).
 *
 * Recipe o'rinbosarlari: `"{{title}}"` (butun qiymat — turi saqlanadi), `"Narx: {{price}}"` (matn ichida),
 * `{{brand.primary}}` va boshqa brand tokenlari. Brand tokeni yo'q bo'lsa (brand kit berilmagan) butun qiymatli
 * kalit olib tashlanadi — layer default qiymat bilan qoladi. Layer `"if": "<slot>"` — slot bo'sh bo'lsa layer yo'q.
 */
import { ASSET_REF_RE, assetKeyOf, fail, layerSchema, ok } from "@aes/shared";
import type {
  Aspect,
  Brand,
  Layer,
  Result,
  Scene,
  TemplateInstantiateParams,
  TemplateManifest,
} from "@aes/shared";
import type { Frame } from "./layout";

/** Compiler'ga beriladigan shablon: manifest, versiya va (aep bo'lsa) ish papkasidagi fayl. */
export interface CompileTemplate {
  manifest: TemplateManifest;
  version: number;
  /** `aep`: ish papkasiga nisbiy `.aep` yo'li (PREFLIGHT'da panelga yuklab qo'yiladi). */
  file?: string;
}

export type TokenValue = string | number | boolean;

export interface ExpandedTemplate {
  /** Recipe layerlari (Spec layerlari sifatida tekshirilgan). */
  layers: Layer[];
  bg?: string;
  /** Aep shablon: `template.instantiate` parametrlari (comp/start/dur'dan tashqari). */
  instantiate?: Omit<TemplateInstantiateParams, "comp" | "start" | "dur">;
  /** Aep media slotlari uchun import qilinadigan asset kalitlari. */
  assets: string[];
  warnings: string[];
}

const TOKEN_RE = /\{\{([a-z0-9_]+(?:\.[a-z0-9_]+)?)\}\}/g;
const WHOLE_TOKEN_RE = /^\{\{([a-z0-9_]+(?:\.[a-z0-9_]+)?)\}\}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/** Brand kit berilmaganda ranglar (shrift va logo yo'q — layer default'i qoladi). */
export const DEFAULT_BRAND_TOKENS: Readonly<Record<string, TokenValue>> = {
  "brand.primary": "#FFCC00",
  "brand.secondary": "#FFFFFF",
  "brand.accent": "#FFCC00",
  "brand.text": "#FFFFFF",
  "brand.background": "#000000",
};

/** Brand kit → `brand.*` tokenlari (P5.04). */
export function brandTokens(brand: Brand | undefined): Record<string, TokenValue> {
  if (brand === undefined) return { ...DEFAULT_BRAND_TOKENS };
  const tokens: Record<string, TokenValue> = {
    "brand.primary": brand.colors.primary,
    "brand.secondary": brand.colors.secondary ?? brand.colors.primary,
    "brand.accent": brand.colors.accent ?? brand.colors.primary,
    "brand.text": brand.colors.text,
    "brand.background": brand.colors.background,
    "brand.heading_font": brand.fonts.heading.family,
    "brand.body_font": brand.fonts.body.family,
    "brand.name": brand.name,
  };
  if (brand.logo !== undefined) tokens["brand.logo"] = brand.logo;
  return tokens;
}

/** Kadr nisbati → eng yaqin aspekt. */
export function aspectOf(frame: Frame): Aspect {
  const ratio = frame.w / frame.h;
  if (ratio < 0.8) return "9:16";
  if (ratio > 1.25) return "16:9";
  return "1:1";
}

type Substituted = { value: unknown } | { drop: true };

function substitute(
  value: unknown,
  tokens: Record<string, TokenValue>,
  unknown: Set<string>,
): Substituted {
  if (typeof value === "string") {
    const whole = WHOLE_TOKEN_RE.exec(value);
    if (whole !== null) {
      const name = whole[1]!;
      if (name in tokens) return { value: tokens[name] };
      if (name.startsWith("brand.")) return { drop: true };
      unknown.add(name);
      return { value };
    }
    return {
      value: value.replace(TOKEN_RE, (match, name: string) => {
        if (name in tokens) return String(tokens[name]);
        if (!name.startsWith("brand.")) unknown.add(name);
        return "";
      }),
    };
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = substitute(item, tokens, unknown);
      if ("value" in next) out.push(next.value);
    }
    return { value: out };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = substitute(item, tokens, unknown);
      if ("value" in next) out[key] = next.value;
    }
    return { value: out };
  }
  return { value };
}

function isEmpty(value: TokenValue | undefined): boolean {
  return value === undefined || value === "" || value === false;
}

/** Sahnadagi shablonni yoyadi; xato bo'lsa JSON Pointer path bilan `SPEC_*`. */
export function expandTemplate(
  scene: Scene,
  index: number,
  templates: Record<string, CompileTemplate>,
  frame: Frame,
  duration: number,
  extraTokens: Record<string, TokenValue>,
): Result<ExpandedTemplate> {
  const base = `/scenes/${index}`;
  const slug = scene.template!;
  const template = templates[slug];
  if (template === undefined) {
    return fail("SPEC_UNKNOWN_TEMPLATE", `${base}/template: '${slug}' shabloni topilmadi`);
  }
  const manifest = template.manifest;
  const warnings: string[] = [];
  const aspect = aspectOf(frame);
  if (!manifest.formats.includes(aspect)) {
    warnings.push(`${scene.id}: '${slug}' shabloni ${aspect} formatga mo'ljallanmagan`);
  }
  if (duration < manifest.duration.min - 1e-6 || duration > manifest.duration.max + 1e-6) {
    warnings.push(
      `${scene.id}: davomiylik ${duration} s shablon oralig'idan tashqarida (${manifest.duration.min}–${manifest.duration.max} s)`,
    );
  }

  // Slot qiymatlari: sahnadagi qiymat yoki manifest default'i; tur bo'yicha tekshiruv.
  const given = scene.slots ?? {};
  for (const name of Object.keys(given)) {
    if (manifest.slots[name] === undefined) {
      return fail(
        "SPEC_INVALID",
        `${base}/slots/${name}: '${slug}' shablonida bunday slot yo'q (bor: ${Object.keys(manifest.slots).join(", ")})`,
      );
    }
  }
  const values: Record<string, TokenValue> = {};
  for (const [name, slot] of Object.entries(manifest.slots)) {
    const raw = given[name] ?? slot.default;
    const path = `${base}/slots/${name}`;
    if (raw === undefined) return fail("SPEC_INVALID", `${path}: majburiy slot berilmagan`);
    if (slot.type === "text") {
      const text = String(raw);
      if (slot.max_chars !== undefined && text.length > slot.max_chars) {
        return fail("SPEC_INVALID", `${path}: ${text.length} belgi, ruxsat ${slot.max_chars}`);
      }
      values[name] = text;
    } else if (slot.type === "media") {
      if (raw === "" && slot.default !== undefined) values[name] = "";
      else if (raw === slot.default && typeof raw === "string" && WHOLE_TOKEN_RE.test(raw)) {
        values[name] = raw;
      } else if (typeof raw !== "string" || !ASSET_REF_RE.test(raw)) {
        return fail("SPEC_INVALID", `${path}: 'asset:<kalit>' havolasi kerak`);
      } else values[name] = raw;
    } else {
      if (typeof raw !== "string" || !(HEX_RE.test(raw) || WHOLE_TOKEN_RE.test(raw))) {
        return fail("SPEC_INVALID", `${path}: '#RRGGBB' rang kerak`);
      }
      values[name] = raw;
    }
  }
  const known: Record<string, TokenValue> = { ...DEFAULT_BRAND_TOKENS, ...extraTokens };
  const tokens: Record<string, TokenValue> = { ...known };
  // Rang slotining default'i brand tokeni bo'lishi mumkin (`{{brand.accent}}`).
  for (const [name, value] of Object.entries(values)) {
    const whole = typeof value === "string" ? WHOLE_TOKEN_RE.exec(value) : null;
    tokens[name] = whole !== null ? (known[whole[1]!] ?? "") : value;
  }

  if (manifest.source === "aep") {
    if (template.file === undefined) {
      return fail("SPEC_UNKNOWN_TEMPLATE", `${base}/template: '${slug}' shablon fayli yo'q`);
    }
    const slots: TemplateInstantiateParams["slots"] = [];
    const assets: string[] = [];
    for (const [name, slot] of Object.entries(manifest.slots)) {
      const value = tokens[name];
      if (slot.type === "text")
        slots.push({ type: "text", layer: slot.layer!, text: String(value) });
      else if (slot.type === "media") {
        if (isEmpty(value)) continue;
        const key = assetKeyOf(String(value))!;
        assets.push(key);
        slots.push({ type: "media", layer: slot.layer!, item: `asset.${key}`, fit: slot.fit });
      } else if (typeof value === "string" && HEX_RE.test(value)) {
        slots.push({ type: "color", egp: slot.egp!, color: value.toUpperCase() });
      }
    }
    return ok({
      layers: [],
      instantiate: {
        template: slug,
        version: template.version,
        file: template.file,
        template_comp: manifest.comp!,
        slots,
        stretch: manifest.duration.stretch,
        name: slug,
      },
      assets,
      warnings,
    });
  }

  // Recipe: o'rinbosarlar → Spec layerlari.
  const layers: Layer[] = [];
  const unknownTokens = new Set<string>();
  for (const [j, raw] of (manifest.layers ?? []).entries()) {
    const { if: condition, ...rest } = raw as { if?: unknown } & Record<string, unknown>;
    if (typeof condition === "string" && isEmpty(tokens[condition])) continue;
    const substituted = substitute(rest, tokens, unknownTokens);
    if (!("value" in substituted)) continue;
    const parsed = layerSchema.safeParse(substituted.value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(
        "SPEC_INVALID",
        `${base}/template: '${slug}' layer ${j} (${issue?.path.join("/") ?? ""}): ${issue?.message ?? "noto'g'ri"}`,
      );
    }
    layers.push(parsed.data);
  }
  if (unknownTokens.size > 0) {
    return fail(
      "SPEC_INVALID",
      `${base}/template: '${slug}' da noma'lum o'rinbosar: ${[...unknownTokens].join(", ")}`,
    );
  }
  let bg: string | undefined;
  if (manifest.bg !== undefined) {
    const value = substitute(manifest.bg, tokens, unknownTokens);
    if ("value" in value && typeof value.value === "string" && HEX_RE.test(value.value)) {
      bg = value.value;
    }
  }
  return ok({ layers, ...(bg === undefined ? {} : { bg }), assets: [], warnings });
}
