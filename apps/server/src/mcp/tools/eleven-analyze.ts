/** P4.07: el_stt (Scribe), el_align, el_isolate, transcript_get, transcript_edit. */
import { fail, ok } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AudioTaskRow } from "../../audio/service";
import { audioTasks } from "../../db/schema";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { uuidArg } from "./common";
import { inputFromAsset, runTask, waitArg } from "./eleven-common";

const sourceArgs = {
  project_id: uuidArg("project_id"),
  key: z.string().min(1).max(128).describe("Audio or video asset key from assets_list"),
  wait_s: waitArg,
};

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  speaker_id?: string | null;
  type?: string;
}

/** Vazifa natijasidan so'zlar (STT yoki alignment); tahrirlangan versiya ustun. */
export function transcriptOf(
  task: AudioTaskRow,
): { text: string; words: TranscriptWord[]; language: string | null; edited: boolean } | null {
  const result = (task.result ?? {}) as {
    transcript?: { text: string; words: TranscriptWord[]; language_code?: string };
    alignment?: { words: TranscriptWord[] };
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
  if (result.alignment !== undefined) {
    const words = result.alignment.words;
    return { text: words.map((w) => w.text).join(" "), words, language: null, edited: false };
  }
  return null;
}

async function ownTask(ctx: ToolContext, id: string): Promise<AudioTaskRow | null> {
  const [row] = await ctx.app.db
    .select()
    .from(audioTasks)
    .where(and(eq(audioTasks.id, id), eq(audioTasks.userId, ctx.userId)))
    .limit(1);
  return row ?? null;
}

export const elevenAnalyzeTools = [
  defineTool({
    name: "el_stt",
    title: "Transcribe (Scribe)",
    description:
      "Transcribes a project video/audio with ElevenLabs Scribe (scribe_v2): word timestamps, speakers (diarize), audio events. The panel extracts the audio locally; then read words with transcript_get. Uzbek accuracy tier: Good.",
    input: z.object({
      ...sourceArgs,
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .optional(),
      diarize: z.boolean().default(false),
      num_speakers: z.number().int().min(1).max(32).optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const audio = await inputFromAsset(ctx, input.project_id, input.key);
      if (!audio.ok) return audio;
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "stt",
          label: `Transkript: ${input.key}`,
          inputs: [audio.data],
          params: {
            model_id: "scribe_v2",
            diarize: input.diarize,
            ...(input.language === undefined ? {} : { language_code: input.language }),
            ...(input.num_speakers === undefined ? {} : { num_speakers: input.num_speakers }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_align",
    title: "Forced alignment",
    description:
      "Aligns a known text to a project audio/video → exact word timings (for subtitles of a recorded voice).",
    input: z.object({ ...sourceArgs, text: z.string().min(1).max(10_000) }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const audio = await inputFromAsset(ctx, input.project_id, input.key);
      if (!audio.ok) return audio;
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "align",
          label: `Alignment: ${input.key}`,
          inputs: [audio.data],
          params: { text: input.text },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_isolate",
    title: "Isolate voice",
    description:
      "Removes background noise/music from a project video/audio, leaving clean speech (new file in audio/).",
    input: z.object(sourceArgs),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const audio = await inputFromAsset(ctx, input.project_id, input.key);
      if (!audio.ok) return audio;
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "isolate",
          label: `Toza ovoz: ${input.key}`,
          inputs: [audio.data],
          params: {},
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "transcript_get",
    title: "Get transcript",
    description:
      "Full transcript of an el_stt / el_align task: text and words with start/end (and speaker). Edited version if transcript_edit was used.",
    input: z.object({ task_id: uuidArg("task_id") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const task = await ownTask(ctx, input.task_id);
      if (task === null) return fail("SYS_NOT_FOUND", "Vazifa topilmadi");
      const transcript = transcriptOf(task);
      if (transcript === null) {
        return fail("JOB_BAD_ACTION", `Transkript yo'q (vazifa: ${task.kind}, ${task.status})`);
      }
      return ok({ task_id: task.id, ...transcript });
    },
  }),

  defineTool({
    name: "transcript_edit",
    title: "Edit transcript",
    description:
      "Fixes transcript words without changing timings (Uzbek spelling, names): either words:[{index,text}] or the full corrected text with the same number of words. Subtitles use the edited version.",
    input: z.object({
      task_id: uuidArg("task_id"),
      words: z
        .array(z.object({ index: z.number().int().min(0), text: z.string().min(1).max(100) }))
        .max(2000)
        .optional(),
      text: z.string().min(1).max(20_000).optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const task = await ownTask(ctx, input.task_id);
      if (task === null) return fail("SYS_NOT_FOUND", "Vazifa topilmadi");
      const current = transcriptOf(task);
      if (current === null) return fail("JOB_BAD_ACTION", "Bu vazifada transkript yo'q");
      if ((input.words === undefined) === (input.text === undefined)) {
        return fail("SYS_BAD_REQUEST", "words yoki text dan aynan bittasini bering");
      }
      const words = current.words.map((word) => ({ ...word }));
      if (input.words !== undefined) {
        for (const edit of input.words) {
          const word = words[edit.index];
          if (word === undefined)
            return fail("SYS_BAD_REQUEST", `So'z indeksi yo'q: ${edit.index}`);
          word.text = edit.text;
        }
      } else {
        const next = input.text!.split(/\s+/).filter(Boolean);
        if (next.length !== words.length) {
          return fail(
            "SYS_BAD_REQUEST",
            `So'zlar soni mos emas: ${next.length} ≠ ${words.length} (vaqtlar saqlanishi uchun)`,
          );
        }
        next.forEach((text, index) => {
          words[index]!.text = text;
        });
      }
      const edited = { text: words.map((w) => w.text).join(" "), words };
      await ctx.app.db
        .update(audioTasks)
        .set({
          result: { ...((task.result ?? {}) as object), transcript_edited: edited },
          updatedAt: ctx.app.now(),
        })
        .where(eq(audioTasks.id, task.id));
      return ok({ task_id: task.id, ...edited, edited: true });
    },
  }),
];
