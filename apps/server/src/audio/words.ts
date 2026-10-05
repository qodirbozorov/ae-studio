/** Audio vazifa natijasidan so'z vaqtlari: TTS alignment, forced alignment yoki (tahrirlangan) STT transkripti. */
import { wordsFromAlignment } from "@aes/compiler";
import type { AlignmentLike } from "@aes/compiler";
import type { CaptionWord } from "@aes/shared";
import type { AudioTaskRow } from "./service";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker_id?: string | null;
  type?: string;
}

export interface TranscriptView {
  text: string;
  words: TranscriptWord[];
  language: string | null;
  edited: boolean;
}

/** STT / alignment natijasi (tahrirlangan versiya ustun). */
export function transcriptOf(task: Pick<AudioTaskRow, "result">): TranscriptView | null {
  const result = (task.result ?? {}) as {
    transcript?: { text: string; words: TranscriptWord[]; language_code?: string };
    alignment?: { words?: TranscriptWord[] };
    transcript_edited?: { text: string; words: TranscriptWord[] };
  };
  if (result.transcript_edited !== undefined) {
    return {
      ...result.transcript_edited,
      language: result.transcript?.language_code ?? null,
      edited: true,
    };
  }
  if (result.transcript !== undefined) {
    return {
      text: result.transcript.text,
      words: result.transcript.words.filter((w) => w.type === undefined || w.type === "word"),
      language: result.transcript.language_code ?? null,
      edited: false,
    };
  }
  if (result.alignment?.words !== undefined) {
    const words = result.alignment.words;
    return { text: words.map((w) => w.text).join(" "), words, language: null, edited: false };
  }
  return null;
}

/** Subtitr va TTS-first timing uchun so'zlar. */
export function wordsOfTask(task: Pick<AudioTaskRow, "kind" | "result">): CaptionWord[] {
  if (task.kind === "tts") {
    const alignment = (task.result as { alignment?: AlignmentLike | null } | null)?.alignment;
    return alignment === null || alignment === undefined ? [] : wordsFromAlignment(alignment);
  }
  const transcript = transcriptOf(task);
  return (transcript?.words ?? []).map((w) => ({ text: w.text, start: w.start, end: w.end }));
}
