/**
 * Tahlil imkoniyatlari: Speech-to-Text / Scribe (`POST /v1/speech-to-text`), Forced Alignment
 * (`POST /v1/forced-alignment`), Audio Isolation (`POST /v1/audio-isolation`).
 */
import { audioResult, formWith } from "./audio";
import type { AudioResult, InputFile } from "./audio";
import type { ElevenClient } from "./client";

export interface Word {
  text: string;
  start: number;
  end: number;
  type: string;
  speaker_id?: string | null;
  logprob?: number;
}

export interface Transcript {
  language_code: string;
  language_probability: number;
  text: string;
  words: Word[];
}

export interface SttParams {
  file: InputFile;
  model_id?: string;
  language_code?: string;
  diarize?: boolean;
  num_speakers?: number;
  tag_audio_events?: boolean;
}

export async function speechToText(client: ElevenClient, params: SttParams): Promise<Transcript> {
  return client.json<Transcript>("POST", "/v1/speech-to-text", {
    body: {
      form: formWith(
        {
          model_id: params.model_id ?? "scribe_v2",
          language_code: params.language_code,
          diarize: params.diarize ?? false,
          num_speakers: params.num_speakers,
          tag_audio_events: params.tag_audio_events ?? true,
          timestamps_granularity: "word",
        },
        [["file", params.file]],
      ),
    },
    timeoutMs: 10 * 60_000,
  });
}

export interface AlignmentResult {
  characters: { text: string; start: number; end: number }[];
  words: { text: string; start: number; end: number; loss: number }[];
  loss: number;
}

export async function forcedAlignment(
  client: ElevenClient,
  params: { file: InputFile; text: string },
): Promise<AlignmentResult> {
  return client.json<AlignmentResult>("POST", "/v1/forced-alignment", {
    body: { form: formWith({ text: params.text }, [["file", params.file]]) },
    timeoutMs: 10 * 60_000,
  });
}

export async function isolate(
  client: ElevenClient,
  params: { file: InputFile },
): Promise<AudioResult> {
  const res = await client.binary("POST", "/v1/audio-isolation", {
    body: { form: formWith({}, [["audio", params.file]]) },
    timeoutMs: 10 * 60_000,
  });
  return audioResult(res.data);
}
