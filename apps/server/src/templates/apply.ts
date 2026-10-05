/**
 * Shablon ↔ Spec yordamchilari (MCP toollari, panel Shablonlar ekrani va batch uchun umumiy):
 * shablondan sahna/Spec yasash, sahnadan recipe yoki aep manifesti yasash.
 */
import { aspectOf, expandTemplate } from "@aes/compiler";
import { fail, ok } from "@aes/shared";
import type {
  Aspect,
  Result,
  Scene,
  TemplateManifest,
  TemplateManifestInput,
  VideoSpec,
} from "@aes/shared";
import type { TemplateEntry } from "./service";

export const ASPECT_FRAMES: Record<Aspect, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
  "16:9": { w: 1920, h: 1080 },
};

type SlotValue = string | number | boolean;

/** Ro'yxat/galereya uchun qisqa ko'rinish. */
export function templateSummary(entry: TemplateEntry, previewUrl: string | null) {
  const m = entry.manifest;
  return {
    slug: entry.slug,
    title: m.title ?? entry.slug,
    description: m.description ?? null,
    source: m.source,
    origin: entry.origin,
    version: entry.version,
    formats: m.formats,
    duration: { min: m.duration.min, max: m.duration.max },
    tags: m.tags ?? [],
    slots: Object.fromEntries(
      Object.entries(m.slots).map(([name, slot]) => [
        name,
        {
          type: slot.type,
          label: slot.label ?? name,
          required: slot.default === undefined,
          ...(slot.default === undefined ? {} : { default: slot.default }),
          ...(slot.type === "text" && slot.max_chars !== undefined
            ? { max_chars: slot.max_chars }
            : {}),
        },
      ]),
    ),
    preview_url: previewUrl,
  };
}

/** Manifest oralig'idagi qulay davomiylik (o'rtasi, 0.5 s ga yaxlitlangan). */
export function defaultDuration(manifest: TemplateManifest): number {
  const mid = (manifest.duration.min + manifest.duration.max) / 2;
  return Math.max(manifest.duration.min, Math.min(manifest.duration.max, Math.round(mid * 2) / 2));
}

/** Namuna sahna (Claude uchun): majburiy slotlar o'rniga ko'rsatma. */
export function exampleScene(manifest: TemplateManifest): Record<string, unknown> {
  const slots: Record<string, SlotValue> = {};
  for (const [name, slot] of Object.entries(manifest.slots)) {
    if (slot.default !== undefined) continue;
    slots[name] =
      slot.type === "text"
        ? `<${slot.label ?? name}>`
        : slot.type === "media"
          ? "asset:<key>"
          : "#RRGGBB";
  }
  return { id: "s1", dur: defaultDuration(manifest), template: manifest.slug, slots };
}

export interface ApplyInput {
  slots: Record<string, SlotValue>;
  dur?: number | undefined;
  sceneId?: string | undefined;
  /** `append` — oxirgi planga qo'shiladi (shu id'li sahna bo'lsa almashtiriladi); `new` — yangi Spec. */
  mode: "append" | "new";
  aspect?: Aspect | undefined;
  outputName?: string | undefined;
}

/** Shablon sahnasini Spec'ga qo'shadi yoki yangi Spec yasaydi; slotlar darhol tekshiriladi. */
export function applyTemplate(
  entry: TemplateEntry,
  base: VideoSpec | null,
  input: ApplyInput,
): Result<{ spec: unknown; sceneId: string }> {
  const manifest = entry.manifest;
  const dur = input.dur ?? defaultDuration(manifest);
  const fresh = input.mode === "new" || base === null;
  const aspect = input.aspect ?? (fresh ? manifest.formats[0]! : aspectOf(base.format));
  const frame = fresh ? ASPECT_FRAMES[aspect] : { w: base.format.w, h: base.format.h };
  const existingIds = new Set(fresh ? [] : base.scenes.map((s) => s.id));
  let sceneId = input.sceneId;
  if (sceneId === undefined) {
    let n = 1;
    while (existingIds.has(`${entry.slug}_${n}`)) n++;
    sceneId = `${entry.slug}_${n}`;
  }
  const scene = { id: sceneId, dur, template: entry.slug, slots: input.slots } as Scene;
  // Slotlarni hozir tekshiramiz (aep fayli bo'lmasa ham — fayl PREFLIGHT'da yuklanadi).
  const check = expandTemplate(
    scene,
    0,
    {
      [entry.slug]: {
        manifest,
        version: entry.version,
        ...(manifest.source === "aep" ? { file: "templates/check.aep" } : {}),
      },
    },
    frame,
    dur,
    {},
  );
  if (!check.ok) return check;

  if (fresh) {
    return ok({
      sceneId,
      spec: {
        version: 1,
        format: { ...frame, fps: 30 },
        scenes: [scene],
        output: { preset: "h264_social", name: input.outputName ?? entry.slug },
      },
    });
  }
  const scenes = existingIds.has(sceneId)
    ? base.scenes.map((s) => (s.id === sceneId ? scene : s))
    : [...base.scenes, scene];
  return ok({
    sceneId,
    spec: {
      ...base,
      scenes,
      ...(input.outputName === undefined
        ? {}
        : { output: { ...base.output, name: input.outputName } }),
    },
  });
}

export interface FromSceneInput {
  slug: string;
  title?: string | undefined;
  description?: string | undefined;
  formats?: Aspect[] | undefined;
  duration?: { min: number; max: number } | undefined;
}

function durationRange(scene: Scene, given?: { min: number; max: number }) {
  if (given !== undefined) return given;
  if (typeof scene.dur !== "number") return { min: 1, max: 30 };
  return {
    min: Math.max(0.5, Math.round(scene.dur * 5) / 10),
    max: Math.min(3600, scene.dur * 2),
  };
}

/** Spec sahnasidan recipe shablon: id'li matn va media layerlar slot bo'ladi (default — joriy qiymat). */
export function recipeFromScene(
  spec: VideoSpec,
  scene: Scene,
  input: FromSceneInput,
): Result<TemplateManifestInput> {
  if (scene.template !== undefined) {
    return fail(
      "SYS_BAD_REQUEST",
      "Shablonli sahnadan shablon saqlanmaydi: oddiy layerli sahna kerak",
    );
  }
  const slots: Record<string, Record<string, unknown>> = {};
  const layers = (scene.layers ?? []).map((layer) => {
    if (layer.id === undefined) return layer;
    if (layer.type === "text") {
      slots[layer.id] = { type: "text", default: layer.text, label: layer.id };
      return { ...layer, text: `{{${layer.id}}}` };
    }
    if (layer.type === "media") {
      slots[layer.id] = { type: "media", fit: layer.fit, default: layer.src, label: layer.id };
      return { ...layer, src: `{{${layer.id}}}` };
    }
    return layer;
  });
  if (Object.keys(slots).length === 0) {
    return fail(
      "SYS_BAD_REQUEST",
      "Sahnada id'li matn yoki media layer yo'q: slot qilinadigan layerlarga 'id' bering",
    );
  }
  return ok({
    slug: input.slug,
    source: "recipe",
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    duration: { ...durationRange(scene, input.duration), stretch: "none" },
    formats: input.formats ?? [aspectOf(spec.format)],
    ...(scene.bg === undefined ? {} : { bg: scene.bg }),
    slots: slots as TemplateManifestInput["slots"],
    layers: layers as Record<string, unknown>[],
  });
}

/** Qurilgan `.aep` dagi sahna comp'idan aep shablon manifesti (fayl alohida yuklanadi). */
export function aepManifestFromScene(
  spec: VideoSpec,
  scene: Scene,
  input: FromSceneInput,
): Result<TemplateManifestInput> {
  const index = spec.scenes.findIndex((s) => s.id === scene.id);
  const slots: Record<string, Record<string, unknown>> = {};
  for (const layer of scene.layers ?? []) {
    if (layer.id === undefined) continue;
    if (layer.type === "text")
      slots[layer.id] = { type: "text", layer: layer.id, default: layer.text };
    if (layer.type === "media") {
      slots[layer.id] = { type: "media", layer: layer.id, fit: layer.fit, default: layer.src };
    }
  }
  return ok({
    slug: input.slug,
    source: "aep",
    comp: `${String(index + 1).padStart(2, "0")}_${scene.id}`,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    duration: { ...durationRange(scene, input.duration), stretch: "time_remap" },
    formats: input.formats ?? [aspectOf(spec.format)],
    slots: slots as TemplateManifestInput["slots"],
  });
}
