/**
 * Video Spec (`plan.json`) sxemasi — ae-studio-plan.md §9.
 *
 * Claude faqat shu Spec'ni yozadi (D4); server uni tekshiradi, compiler oplarga aylantiradi.
 * Obyektlar `strictObject`: noma'lum kalit (masalan, `transtion_out`) aniq path bilan rad etiladi.
 * Pikselli o'lchamlar asosiy `format` ga nisbatan; variantlar uchun compiler moslashtiradi.
 */
import { z } from "zod";
import { checkContents, maskShapeCount, proLayerFields, shapeContentSchema } from "./pro";
import {
  ASSET_REF_RE,
  assetKeyOf,
  assetRefSchema,
  hexColorSchema,
  languageSchema,
  parseWith,
  slugSchema,
} from "./common";
import type { Result } from "./result";

export const SPEC_VERSION = 1;

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export const ANIMS = [
  "none",
  "fade_in",
  "ken_burns_in",
  "ken_burns_out",
  "typewriter",
  "pop",
  "slide_up",
  "slide_down",
  "slide_left",
  "slide_right",
  "zoom_in",
] as const;
export const POSITIONS = [
  "center",
  "top",
  "bottom",
  "upper_third",
  "lower_third",
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const;
export const TRANSITIONS = [
  "none",
  "fade",
  "whip_left",
  "whip_right",
  "whip_up",
  "whip_down",
  "zoom_in",
  "zoom_out",
  "slide_left",
  "slide_right",
] as const;
export const FITS = ["cover", "contain", "stretch"] as const;
export const OUTPUT_PRESETS = ["h264_social", "h264_hq"] as const;
export type OutputPreset = (typeof OUTPUT_PRESETS)[number];
export const CAPTION_METHODS = ["tts_timestamps", "stt", "align"] as const;

// ---------------------------------------------------------------- davomiylik va langarlar

const VO_RANGE_RE = /^vo:(\d{1,3})-(\d{1,3})$/;

/**
 * `vo:a-b` — voiceover gap chegaralari [a, b) (0 dan boshlanadi): `vo:0-1` = 1-gap,
 * `vo:1-3` = 2- va 3-gaplar. Haqiqiy soniyalar PREFLIGHT'da TTS timestamps'dan hisoblanadi.
 */
export function parseVoRange(dur: string): { from: number; to: number } | null {
  const match = VO_RANGE_RE.exec(dur);
  if (!match) return null;
  return { from: Number(match[1]), to: Number(match[2]) };
}

const SCENE_ANCHOR_RE = /^([a-z0-9][a-z0-9_-]{0,63})\.(start|end)(?:([+-])(\d+(?:\.\d+)?))?$/;

/** `s1.end`, `s2.start+0.5`, `s3.end-0.2` → sahna chegarasiga nisbatan vaqt. */
export function parseSceneAnchor(
  at: string,
): { scene: string; edge: "start" | "end"; offset: number } | null {
  const match = SCENE_ANCHOR_RE.exec(at);
  if (!match) return null;
  const magnitude = match[4] ? Number(match[4]) : 0;
  return {
    scene: match[1] ?? "",
    edge: match[2] === "start" ? "start" : "end",
    offset: match[3] === "-" ? -magnitude : magnitude,
  };
}

const sceneDurationSchema = z.union([
  z.number().positive().max(3600),
  z
    .string()
    .regex(VO_RANGE_RE, { error: "dur soniya (son) yoki 'vo:a-b' ko'rinishida bo'lishi kerak" })
    .refine(
      (value) => {
        const range = parseVoRange(value);
        return range !== null && range.from < range.to;
      },
      { error: "'vo:a-b' da a < b bo'lishi kerak" },
    ),
]);

const volumeDbSchema = z.number().min(-60).max(12);

const positionSchema = z.union([
  z.enum(POSITIONS),
  z.strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
]);

// ---------------------------------------------------------------- layerlar

const layerTiming = {
  /** Barqaror id: patch va op_id uchun (sahna ichida yagona). */
  id: slugSchema.optional(),
  /** Sahna boshidan siljish, soniya. */
  start: z.number().min(0).max(3600).optional(),
  /** Davomiylik, soniya; berilmasa sahna oxirigacha. */
  dur: z.number().positive().max(3600).optional(),
};

export const textStyleSchema = z.strictObject({
  /** Shriftning PostScript nomi (masalan `Montserrat-Bold`). Berilmasa brand shrifti. */
  font: z.string().min(1).max(128).optional(),
  /** Piksel, asosiy formatga nisbatan. */
  size: z.number().positive().max(1000).optional(),
  color: hexColorSchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  stroke_color: hexColorSchema.optional(),
  stroke_width: z.number().min(0).max(100).optional(),
  all_caps: z.boolean().optional(),
});

const mediaLayerSchema = z.strictObject({
  type: z.literal("media"),
  ...layerTiming,
  src: assetRefSchema,
  anim: z.enum(ANIMS).default("none"),
  fit: z.enum(FITS).default("cover"),
  /** `fit` o'lchamiga nisbatan (1 — butun kadr; 0.3 — logo kabi kichik). */
  scale: z.number().gt(0).max(4).default(1),
  pos: positionSchema.default("center"),
  opacity: z.number().min(0).max(100).default(100),
  /** Video ichidagi ovozni qoldirish. */
  keep_audio: z.boolean().default(false),
  volume_db: volumeDbSchema.default(0),
  ...proLayerFields,
});

const textLayerSchema = z.strictObject({
  type: z.literal("text"),
  ...layerTiming,
  text: z.string().min(1).max(500),
  anim: z.enum(ANIMS).default("none"),
  pos: positionSchema.default("center"),
  style: textStyleSchema.default({}),
  /** Matn qutisining eni, format eniga nisbatan (0–1]. */
  max_width: z.number().gt(0).max(1).default(0.9),
  ...proLayerFields,
});

const shapeLayerSchema = z.strictObject({
  type: z.literal("shape"),
  ...layerTiming,
  /** Oddiy shakl (v1): `kind` + `color` + `size`. Murakkab shakllar uchun `contents`. */
  kind: z.enum(["rect", "ellipse"]).optional(),
  color: hexColorSchema.optional(),
  /** Format o'lchamiga nisbatan (0–1]. */
  size: z
    .strictObject({
      w: z.number().gt(0).max(1),
      h: z.number().gt(0).max(1),
    })
    .optional(),
  contents: z
    .array(shapeContentSchema)
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Professional shape contents (vector groups) in px relative to the layer origin (pos). Use instead of kind/color/size",
    ),
  pos: positionSchema.default("center"),
  anim: z.enum(ANIMS).default("none"),
  opacity: z.number().min(0).max(100).default(100),
  /** Burchak radiusi, piksel (faqat rect). */
  radius: z.number().min(0).max(1000).default(0),
  ...proLayerFields,
});

const solidLayerSchema = z.strictObject({
  type: z.literal("solid"),
  ...layerTiming,
  color: hexColorSchema,
  /** Piksel; berilmasa butun kadr. */
  size: z.tuple([z.number().positive().max(30_000), z.number().positive().max(30_000)]).optional(),
  pos: positionSchema.default("center"),
  anim: z.enum(ANIMS).default("none"),
  opacity: z.number().min(0).max(100).default(100),
  ...proLayerFields,
});

const iconLayerSchema = z.strictObject({
  type: z.literal("icon"),
  ...layerTiming,
  name: z
    .string()
    .regex(/^(lucide:)?[a-z0-9-]{1,64}$/, { error: "Lucide ikonka nomi (icons_search)" })
    .describe("Lucide icon name from icons_search, e.g. lucide:bell"),
  /** Piksel (ikonka kvadrati). */
  size: z.number().positive().max(1024).default(96),
  color: hexColorSchema.default("#FFFFFF"),
  stroke_width: z.number().min(0.25).max(6).default(2),
  pos: positionSchema.default("center"),
  anim: z.enum(ANIMS).default("none"),
  opacity: z.number().min(0).max(100).default(100),
  as_shapes: z
    .boolean()
    .default(false)
    .describe(
      "Convert to an AE shape layer (Create Shapes from Vector Layer) — only when its paths must be animated (trim draw-on, per-path color)",
    ),
  ...proLayerFields,
});

const nullLayerSchema = z.strictObject({
  type: z.literal("null"),
  ...layerTiming,
  pos: positionSchema.default("center"),
  ...proLayerFields,
});

const adjustmentLayerSchema = z.strictObject({
  type: z.literal("adjustment"),
  ...layerTiming,
  ...proLayerFields,
});

const audioLayerSchema = z.strictObject({
  type: z.literal("audio"),
  ...layerTiming,
  src: assetRefSchema,
  volume_db: volumeDbSchema.default(0),
});

export const layerSchema = z.discriminatedUnion(
  "type",
  [
    mediaLayerSchema,
    textLayerSchema,
    shapeLayerSchema,
    solidLayerSchema,
    iconLayerSchema,
    nullLayerSchema,
    adjustmentLayerSchema,
    audioLayerSchema,
  ],
  {
    error:
      "Layer 'type' quyidagilardan biri bo'lishi kerak: media, text, shape, solid, icon, null, adjustment, audio",
  },
);

// ---------------------------------------------------------------- sahnalar

export const sceneSchema = z
  .strictObject({
    id: slugSchema,
    dur: sceneDurationSchema,
    /** Shablon slug'i (§11.2); slotlar `slots` da. */
    template: slugSchema.optional(),
    /** Slot qiymatlari: matn, `asset:` havola, rang yoki son. */
    slots: z
      .record(
        z.string().regex(/^[a-z0-9_]{1,64}$/, { error: "Slot nomi: kichik harf, raqam, '_'" }),
        z.union([z.string().max(500), z.number(), z.boolean()]),
      )
      .optional(),
    layers: z.array(layerSchema).max(50).optional(),
    bg: hexColorSchema.optional(),
    transition_out: z.enum(TRANSITIONS).default("none"),
  })
  .superRefine((scene, ctx) => {
    const hasLayers = scene.layers !== undefined && scene.layers.length > 0;
    if (scene.template === undefined && !hasLayers) {
      ctx.addIssue({
        code: "custom",
        path: ["layers"],
        message: "Sahnada 'template' yoki kamida bitta layer bo'lishi kerak",
      });
    }
    if (scene.template === undefined && scene.slots !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["slots"],
        message: "'slots' faqat 'template' bilan ishlatiladi",
      });
    }
    const seen = new Set<string>();
    (scene.layers ?? []).forEach((layer, index) => {
      if (layer.id === undefined) return;
      if (seen.has(layer.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["layers", index, "id"],
          message: "Layer id sahna ichida takrorlanmasligi kerak: " + layer.id,
        });
      }
      seen.add(layer.id);
    });
    (scene.layers ?? []).forEach((layer, index) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({ code: "custom", path: ["layers", index, ...path], message });
      if (layer.type === "audio") return;
      // Professional maydonlar (Faza 7): havolalar shu sahnadagi layer id'lariga.
      for (const field of ["parent", "matte"] as const) {
        const ref = field === "parent" ? layer.parent : layer.matte?.source;
        if (ref === undefined) continue;
        if (!seen.has(ref)) issue([field], `${field}: sahnada '${ref}' id'li layer yo'q`);
        if (ref === layer.id) issue([field], `${field}: layer o'ziga havola qila olmaydi`);
      }
      (layer.masks ?? []).forEach((mask, m) => {
        if (maskShapeCount(mask) !== 1) {
          issue(
            ["masks", m],
            "Maskada rect, ellipse, path yoki svg_d dan aynan bittasi bo'lishi kerak",
          );
        }
      });
      if (layer.type === "shape") {
        if (layer.contents === undefined) {
          if (layer.kind === undefined || layer.color === undefined || layer.size === undefined) {
            issue(["contents"], "Shape uchun 'contents' yoki 'kind' + 'color' + 'size' kerak");
          }
        } else {
          const problems: [(string | number)[], string][] = [];
          checkContents(layer.contents, ["contents"], new Set(), problems);
          for (const [path, message] of problems) issue(path, message);
        }
      }
    });
    // Parent sikli: a → b → a.
    const parents = new Map<string, string>();
    for (const layer of scene.layers ?? []) {
      if (layer.type !== "audio" && layer.id !== undefined && layer.parent !== undefined) {
        parents.set(layer.id, layer.parent);
      }
    }
    for (const start of parents.keys()) {
      let current: string | undefined = start;
      for (let steps = 0; current !== undefined && steps <= parents.size; steps++) {
        current = parents.get(current);
        if (current === start) {
          ctx.addIssue({ code: "custom", path: ["layers"], message: "parent sikli: " + start });
          return;
        }
      }
    }
  });

// ---------------------------------------------------------------- audio (§7)

const voiceSettingsSchema = z.strictObject({
  stability: z.number().min(0).max(1).optional(),
  similarity_boost: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.5).max(2).optional(),
  use_speaker_boost: z.boolean().optional(),
});

const voiceIdSchema = z.string().min(1).max(64);
const modelIdSchema = z.string().min(1).max(64);

export const voiceoverSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("tts"),
      /** Berilmasa brand kit ovozi (`brand.voice`). */
      voice_id: voiceIdSchema.optional(),
      model_id: modelIdSchema.optional(),
      text: z.string().min(1).max(10000),
      language: languageSchema.optional(),
      /** Pronunciation dictionary slug'lari (brend nomlari, o'zbekcha so'zlar). */
      pronunciation: z.array(slugSchema).max(10).default([]),
      voice_settings: voiceSettingsSchema.optional(),
    }),
    z.strictObject({
      kind: z.literal("dialogue"),
      model_id: modelIdSchema.optional(),
      lines: z
        .array(z.strictObject({ voice_id: voiceIdSchema, text: z.string().min(1).max(2000) }))
        .min(1)
        .max(200),
    }),
    z.strictObject({
      /** Tayyor yozilgan ovoz; `text` berilsa forced alignment bilan so'z vaqtlari olinadi. */
      kind: z.literal("asset"),
      asset: assetRefSchema,
      text: z.string().min(1).max(10000).optional(),
    }),
  ],
  { error: "voiceover 'kind' quyidagilardan biri bo'lishi kerak: tts, dialogue, asset" },
);

const duckFields = {
  /** Musiqa shu ovoz ostida pasayadi (`audio.duck`). */
  duck_under: z.literal("voiceover").optional(),
  duck_db: z.number().min(-40).max(0).default(-12),
  volume_db: volumeDbSchema.default(0),
};

export const musicSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("music"),
      /** Berilmasa brand kit musiqa uslubi (`brand.music_style`). */
      prompt: z.string().min(1).max(2000).optional(),
      length: z
        .union([z.literal("match_video"), z.number().min(5).max(600)])
        .default("match_video"),
      instrumental: z.boolean().default(true),
      ...duckFields,
    }),
    z.strictObject({
      kind: z.literal("asset"),
      asset: assetRefSchema,
      ...duckFields,
    }),
  ],
  { error: "music 'kind' quyidagilardan biri bo'lishi kerak: music, asset" },
);

export const sfxSchema = z
  .strictObject({
    id: slugSchema,
    /** Generatsiya uchun tavsif (ElevenLabs Sound Effects) yoki tayyor `asset`. */
    prompt: z.string().min(1).max(500).optional(),
    asset: assetRefSchema.optional(),
    duration_s: z.number().min(0.5).max(30).optional(),
    /** Absolyut soniya yoki sahna langari: `s1.end`, `s2.start+0.5`. */
    at: z.union([
      z.number().min(0),
      z.string().regex(SCENE_ANCHOR_RE, {
        error: "'at' soniya yoki 's1.end' / 's2.start+0.5' ko'rinishida bo'lishi kerak",
      }),
    ]),
    volume_db: volumeDbSchema.default(0),
  })
  .superRefine((sfx, ctx) => {
    if ((sfx.prompt === undefined) === (sfx.asset === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "SFX'da 'prompt' yoki 'asset' dan aynan bittasi bo'lishi kerak",
      });
    }
  });

export const captionsSchema = z.strictObject({
  from: z.enum(["voiceover", "source_audio"]),
  method: z.enum(CAPTION_METHODS).default("tts_timestamps"),
  /** Subtitr stili slug'i (karaoke_bold, bold_pop, minimal ...); berilmasa brand kit stili. */
  style: slugSchema.optional(),
  pos: positionSchema.default("lower_third"),
  max_words: z.number().int().min(1).max(12).default(4),
});

export const sourceAudioSchema = z.strictObject({
  asset: assetRefSchema,
  isolate: z.boolean().default(false),
  transcribe: z.boolean().default(false),
  language: languageSchema.optional(),
  /** Asl (yoki tozalangan) ovoz videoda qoladimi. */
  use_in_video: z.boolean().default(true),
});

export const specAudioSchema = z.strictObject({
  voiceover: voiceoverSchema.optional(),
  music: musicSchema.optional(),
  sfx: z.array(sfxSchema).max(100).default([]),
  captions: captionsSchema.optional(),
  source_audio: sourceAudioSchema.optional(),
});

// ---------------------------------------------------------------- Spec

const evenDimension = z
  .number()
  .int()
  .min(16)
  .max(8192)
  .refine((n) => n % 2 === 0, { error: "O'lcham juft son bo'lishi kerak (H.264 talabi)" });

export const formatSchema = z.strictObject({
  w: evenDimension,
  h: evenDimension,
  fps: z.number().positive().max(120),
  /** Soniya yoki `auto` (sahnalar / voiceover bo'yicha). */
  duration: z.union([z.literal("auto"), z.number().positive().max(10800)]).default("auto"),
});

export const outputSchema = z.strictObject({
  preset: z.enum(OUTPUT_PRESETS).default("h264_social"),
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, {
    error: "Fayl nomi: lotin harf, raqam, '_', '-' (1–64 belgi)",
  }),
});

export const videoSpecSchema = z
  .strictObject({
    version: z.literal(SPEC_VERSION),
    format: formatSchema,
    /** Chiqish aspektlari; bo'sh bo'lsa faqat asosiy format. */
    variants: z.array(z.enum(ASPECTS)).max(ASPECTS.length).default([]),
    brand: slugSchema.default("default"),
    audio: specAudioSchema.optional(),
    scenes: z.array(sceneSchema).min(1).max(100),
    output: outputSchema.default({ preset: "h264_social", name: "video" }),
  })
  .superRefine((spec, ctx) => {
    const issue = (path: PropertyKey[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    if (new Set(spec.variants).size !== spec.variants.length) {
      issue(["variants"], "Variantlar takrorlanmasligi kerak");
    }

    const sceneIds = new Set<string>();
    spec.scenes.forEach((scene, index) => {
      if (sceneIds.has(scene.id))
        issue(["scenes", index, "id"], "Sahna id takrorlangan: " + scene.id);
      sceneIds.add(scene.id);
    });

    // TTS-first timing: vo: sahnalar voiceover talab qiladi va gaplarni uzluksiz qoplaydi.
    const audio = spec.audio;
    let previousVoEnd: number | null = null;
    spec.scenes.forEach((scene, index) => {
      if (typeof scene.dur !== "string") return;
      const range = parseVoRange(scene.dur);
      if (range === null) return;
      if (audio?.voiceover === undefined) {
        issue(["scenes", index, "dur"], "'vo:' davomiyligi uchun audio.voiceover kerak");
      }
      if (previousVoEnd !== null && range.from !== previousVoEnd) {
        issue(
          ["scenes", index, "dur"],
          "vo: oraliqlari uzluksiz bo'lishi kerak: kutilgan 'vo:" + previousVoEnd + "-…'",
        );
      }
      previousVoEnd = range.to;
    });

    if (audio === undefined) return;

    const sfxIds = new Set<string>();
    audio.sfx.forEach((sfx, index) => {
      if (sfxIds.has(sfx.id))
        issue(["audio", "sfx", index, "id"], "SFX id takrorlangan: " + sfx.id);
      sfxIds.add(sfx.id);
      if (typeof sfx.at === "string") {
        const anchor = parseSceneAnchor(sfx.at);
        if (anchor !== null && !sceneIds.has(anchor.scene)) {
          issue(["audio", "sfx", index, "at"], "Noma'lum sahna: " + anchor.scene);
        }
      }
    });

    if (audio.music?.duck_under === "voiceover" && audio.voiceover === undefined) {
      issue(
        ["audio", "music", "duck_under"],
        "duck_under: 'voiceover' uchun audio.voiceover kerak",
      );
    }

    const captions = audio.captions;
    if (captions !== undefined) {
      if (captions.from === "voiceover" && audio.voiceover === undefined) {
        issue(
          ["audio", "captions", "from"],
          "Subtitr manbasi voiceover, lekin audio.voiceover yo'q",
        );
      }
      if (captions.from === "source_audio" && audio.source_audio === undefined) {
        issue(["audio", "captions", "from"], "Subtitr manbasi source_audio, lekin u berilmagan");
      }
      const tts = captions.from === "voiceover" && audio.voiceover?.kind === "tts";
      if (captions.method === "tts_timestamps" && !tts) {
        issue(
          ["audio", "captions", "method"],
          "'tts_timestamps' faqat TTS voiceover uchun ishlaydi",
        );
      }
    }
  });

export type VideoSpec = z.output<typeof videoSpecSchema>;
export type VideoSpecInput = z.input<typeof videoSpecSchema>;
export type Scene = z.output<typeof sceneSchema>;
export type Layer = z.output<typeof layerSchema>;
export type TextStyle = z.output<typeof textStyleSchema>;
export type Position = z.output<typeof positionSchema>;
export type Anim = (typeof ANIMS)[number];
export type Transition = (typeof TRANSITIONS)[number];
export type Aspect = (typeof ASPECTS)[number];

/** Spec'ni tekshiradi; xato bo'lsa `SPEC_INVALID` + har xato uchun JSON Pointer path. */
export function parseSpec(input: unknown): Result<VideoSpec> {
  return parseWith(videoSpecSchema, input, "SPEC_INVALID");
}

/** Spec'dagi barcha `asset:` havolalarining kalitlari (takrorsiz, uchragan tartibda). */
export function collectAssetRefs(spec: VideoSpec): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && ASSET_REF_RE.test(value)) {
      const key = assetKeyOf(value);
      if (key !== null) keys.add(key);
    }
  };
  const audio = spec.audio;
  if (audio !== undefined) {
    if (audio.voiceover?.kind === "asset") add(audio.voiceover.asset);
    if (audio.music?.kind === "asset") add(audio.music.asset);
    audio.sfx.forEach((sfx) => add(sfx.asset));
    add(audio.source_audio?.asset);
  }
  for (const scene of spec.scenes) {
    for (const value of Object.values(scene.slots ?? {})) add(value);
    for (const layer of scene.layers ?? []) {
      if (layer.type === "media" || layer.type === "audio") add(layer.src);
    }
  }
  return [...keys];
}

let cachedJsonSchema: Record<string, unknown> | undefined;

/** MCP tool `inputSchema` uchun JSON Schema (kiritish shakli: default'li maydonlar ixtiyoriy). */
export function specJsonSchema(): Record<string, unknown> {
  cachedJsonSchema ??= z.toJSONSchema(videoSpecSchema, { io: "input" }) as Record<string, unknown>;
  return cachedJsonSchema;
}

/**
 * Brand kit'dan to'ldiriladigan audio maydonlari yo'q bo'lsa xato matni (CHECK/preflight):
 * TTS ovozi (`voice_id` yoki `brand.voice`) va musiqa tavsifi (`prompt` yoki `brand.music_style`).
 */
export function missingBrandAudio(
  spec: VideoSpec,
  brand: { voice?: { voice_id: string } | undefined; music_style?: string | undefined } | undefined,
): string | null {
  const audio = spec.audio;
  if (audio?.voiceover?.kind === "tts" && audio.voiceover.voice_id === undefined) {
    if (brand?.voice === undefined) {
      return "/audio/voiceover/voice_id: ovoz berilmagan va brand kit'da default ovoz yo'q (el_voices)";
    }
  }
  if (audio?.music?.kind === "music" && audio.music.prompt === undefined) {
    if (brand?.music_style === undefined) {
      return "/audio/music/prompt: musiqa tavsifi berilmagan va brand kit'da music_style yo'q";
    }
  }
  return null;
}

/** Spec ElevenLabs'ni talab qiladimi (CHECK: kalit va kvota kerak). */
export function audioUsesEleven(spec: VideoSpec): boolean {
  const audio = spec.audio;
  if (audio === undefined) return false;
  const vo = audio.voiceover;
  if (vo !== undefined && (vo.kind !== "asset" || vo.text !== undefined)) return true;
  if (audio.music?.kind === "music") return true;
  if (audio.sfx.some((sfx) => sfx.prompt !== undefined)) return true;
  if (audio.captions !== undefined && audio.captions.method !== "tts_timestamps") return true;
  const source = audio.source_audio;
  return source !== undefined && (source.isolate || source.transcribe);
}
