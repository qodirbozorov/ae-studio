/** Text-to-Speech (`POST /v1/text-to-speech/{voice_id}/with-timestamps`): audio + belgi vaqtlari. */
import { DEFAULT_OUTPUT, audioResult } from "./audio";
import type { AudioResult } from "./audio";
import type { ElevenClient } from "./client";

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TtsParams {
  voice_id: string;
  text: string;
  model_id?: string;
  language_code?: string;
  voice_settings?: Record<string, number | boolean>;
  pronunciation_dictionary_locators?: { pronunciation_dictionary_id: string; version_id: string }[];
  seed?: number;
}

export async function tts(client: ElevenClient, params: TtsParams): Promise<AudioResult> {
  const { voice_id, ...body } = params;
  const res = await client.json<{
    audio_base64: string;
    alignment: Alignment | null;
    normalized_alignment: Alignment | null;
  }>("POST", `/v1/text-to-speech/${encodeURIComponent(voice_id)}/with-timestamps`, {
    query: { output_format: DEFAULT_OUTPUT },
    body: { json: body },
  });
  return audioResult(Buffer.from(res.audio_base64, "base64"), {
    alignment: res.alignment,
    normalized_alignment: res.normalized_alignment,
  });
}
