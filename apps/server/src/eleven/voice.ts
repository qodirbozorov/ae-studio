/**
 * Ovoz bilan ishlash: Voice Changer / STS (`POST /v1/speech-to-speech/{voice_id}`), Dubbing (asinxron),
 * Voice Design (+ saqlash), Instant Voice Clone, ovozlar va modellar ro'yxati, pronunciation dictionaries.
 */
import { makeError } from "@aes/shared";
import { DEFAULT_OUTPUT, audioResult, formWith } from "./audio";
import type { AudioResult, InputFile } from "./audio";
import type { ElevenClient } from "./client";
import { ElevenError } from "./client";

// ---------------------------------------------------------------- Voice Changer

export interface VoiceChangeParams {
  voice_id: string;
  file: InputFile;
  model_id?: string;
  remove_background_noise?: boolean;
}

export async function voiceChange(
  client: ElevenClient,
  params: VoiceChangeParams,
): Promise<AudioResult> {
  const res = await client.binary(
    "POST",
    `/v1/speech-to-speech/${encodeURIComponent(params.voice_id)}`,
    {
      query: { output_format: DEFAULT_OUTPUT },
      body: {
        form: formWith(
          {
            model_id: params.model_id ?? "eleven_multilingual_sts_v2",
            remove_background_noise: params.remove_background_noise ?? false,
          },
          [["audio", params.file]],
        ),
      },
      timeoutMs: 10 * 60_000,
    },
  );
  return audioResult(res.data);
}

// ---------------------------------------------------------------- Dubbing (asinxron, §7.1: 30 daqiqa)

export interface DubParams {
  file: InputFile;
  target_lang: string;
  source_lang?: string;
  num_speakers?: number;
  name?: string;
}

export interface PollOptions {
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

export async function dub(
  client: ElevenClient,
  params: DubParams,
  options: PollOptions = {},
): Promise<AudioResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const created = await client.json<{ dubbing_id: string; expected_duration_sec: number }>(
    "POST",
    "/v1/dubbing",
    {
      body: {
        form: formWith(
          {
            target_lang: params.target_lang,
            source_lang: params.source_lang ?? "auto",
            num_speakers: params.num_speakers ?? 0,
            name: params.name ?? "AE Studio",
            watermark: false,
          },
          [["file", params.file]],
        ),
      },
      timeoutMs: 10 * 60_000,
    },
  );
  const id = encodeURIComponent(created.dubbing_id);
  const deadline = now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const status = await client.json<{ status: string; error?: string | null }>(
      "GET",
      `/v1/dubbing/${id}`,
    );
    if (status.status === "dubbed") break;
    if (status.status === "failed") {
      throw new ElevenError(
        makeError("EL_BAD_PARAMS", `Dubbing muvaffaqiyatsiz: ${status.error ?? ""}`),
      );
    }
    if (now() > deadline) {
      throw new ElevenError(makeError("EL_TIMEOUT", "Dubbing 30 daqiqada tugamadi"));
    }
    await sleep(options.pollMs ?? 10_000);
  }
  const res = await client.binary(
    "GET",
    `/v1/dubbing/${id}/audio/${encodeURIComponent(params.target_lang)}`,
    { timeoutMs: 10 * 60_000 },
  );
  return audioResult(res.data, { dubbing_id: created.dubbing_id });
}

// ---------------------------------------------------------------- Voice Design

export interface DesignPreview {
  generated_voice_id: string;
  audio_base_64: string;
  media_type: string;
  duration_secs: number;
  language?: string;
}

export async function designVoice(
  client: ElevenClient,
  params: { voice_description: string; text?: string; model_id?: string },
): Promise<{ previews: DesignPreview[]; text: string }> {
  return client.json("POST", "/v1/text-to-voice/design", {
    body: {
      json: {
        model_id: params.model_id ?? "eleven_multilingual_ttv_v2",
        voice_description: params.voice_description,
        ...(params.text === undefined ? { auto_generate_text: true } : { text: params.text }),
      },
    },
  });
}

export async function createDesignedVoice(
  client: ElevenClient,
  params: { voice_name: string; voice_description: string; generated_voice_id: string },
): Promise<{ voice_id: string }> {
  return client.json("POST", "/v1/text-to-voice", { body: { json: params } });
}

// ---------------------------------------------------------------- Instant Voice Clone (rozilik tool'da tekshiriladi)

export async function cloneVoice(
  client: ElevenClient,
  params: {
    name: string;
    files: InputFile[];
    description?: string;
    remove_background_noise?: boolean;
  },
): Promise<{ voice_id: string; requires_verification: boolean }> {
  return client.json("POST", "/v1/voices/add", {
    body: {
      form: formWith(
        {
          name: params.name,
          description: params.description,
          remove_background_noise: params.remove_background_noise ?? true,
        },
        params.files.map((file) => ["files", file] as [string, InputFile]),
      ),
    },
    timeoutMs: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- ovozlar, modellar, talaffuz

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string | null;
}

export interface Model {
  model_id: string;
  name: string;
  can_do_text_to_speech?: boolean;
  languages?: { language_id: string; name: string }[];
}

export async function listVoices(
  client: ElevenClient,
  params: { search?: string; page_size?: number } = {},
): Promise<Voice[]> {
  const res = await client.json<{ voices: Voice[] }>("GET", "/v2/voices", {
    query: { page_size: params.page_size ?? 100, search: params.search },
  });
  return res.voices;
}

export async function listModels(client: ElevenClient): Promise<Model[]> {
  return client.json<Model[]>("GET", "/v1/models");
}

export type PronunciationRule =
  | { type: "alias"; string_to_replace: string; alias: string }
  | {
      type: "phoneme";
      string_to_replace: string;
      phoneme: string;
      alphabet: "ipa" | "cmu-arpabet";
    };

export async function createDictionary(
  client: ElevenClient,
  params: { name: string; rules: PronunciationRule[]; description?: string },
): Promise<{ id: string; version_id: string; name: string }> {
  return client.json("POST", "/v1/pronunciation-dictionaries/add-from-rules", {
    body: { json: params },
  });
}
