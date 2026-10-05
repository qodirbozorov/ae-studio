/** Audio vazifalari (§7.1): yagona `audio_task` modeli. */

export const AUDIO_KINDS = [
  "tts",
  "dialogue",
  "sfx",
  "music",
  "stt",
  "align",
  "isolate",
  "voice_change",
  "dub",
  "voice_design",
] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

/** Kirish audiosi kerak bo'lgan turlar (panel `audio.extract.request` → storage `audio-in`). */
export const AUDIO_INPUT_KINDS: readonly AudioKind[] = [
  "stt",
  "align",
  "isolate",
  "voice_change",
  "dub",
];

export const AUDIO_TASK_STATUSES = ["queued", "running", "done", "failed", "skipped"] as const;
export type AudioTaskStatus = (typeof AUDIO_TASK_STATUSES)[number];
