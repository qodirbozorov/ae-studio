/**
 * Generatsiya imkoniyatlari: Text-to-Dialogue (`POST /v1/text-to-dialogue`), Sound Effects
 * (`POST /v1/sound-generation`), Music (`POST /v1/music`) va composition plan (`POST /v1/music/plan`).
 */
import { DEFAULT_OUTPUT, audioResult } from "./audio";
import type { AudioResult } from "./audio";
import type { ElevenClient } from "./client";

export interface DialogueParams {
  inputs: { text: string; voice_id: string }[];
  model_id?: string;
  language_code?: string;
  seed?: number;
}

export async function dialogue(client: ElevenClient, params: DialogueParams): Promise<AudioResult> {
  const res = await client.binary("POST", "/v1/text-to-dialogue", {
    query: { output_format: DEFAULT_OUTPUT },
    body: { json: { model_id: "eleven_v3", ...params } },
  });
  return audioResult(res.data);
}

export interface SfxParams {
  text: string;
  duration_seconds?: number;
  prompt_influence?: number;
  loop?: boolean;
}

export async function soundEffect(client: ElevenClient, params: SfxParams): Promise<AudioResult> {
  const res = await client.binary("POST", "/v1/sound-generation", {
    query: { output_format: DEFAULT_OUTPUT },
    body: { json: { model_id: "eleven_text_to_sound_v2", ...params } },
  });
  return audioResult(res.data);
}

export interface MusicSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
}

export interface CompositionPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: MusicSection[];
}

/** `prompt` va `composition_plan` birga ishlatilmaydi (rasmiy hujjat). */
export type MusicParams =
  | { prompt: string; music_length_ms?: number; force_instrumental?: boolean; model_id?: string }
  | { composition_plan: CompositionPlan; model_id?: string };

export async function music(client: ElevenClient, params: MusicParams): Promise<AudioResult> {
  const res = await client.binary("POST", "/v1/music", {
    query: { output_format: DEFAULT_OUTPUT },
    body: { json: params },
    timeoutMs: 10 * 60_000,
  });
  return audioResult(res.data);
}

export async function musicPlan(
  client: ElevenClient,
  params: { prompt: string; music_length_ms?: number; model_id?: string },
): Promise<CompositionPlan> {
  return client.json<CompositionPlan>("POST", "/v1/music/plan", { body: { json: params } });
}
