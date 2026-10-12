/** P4.07: audio_transcribe (Scribe), audio_align, audio_isolate, transcript_get, transcript_edit. */
import { fail, ok, quoteAudio } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AudioTaskRow } from "../../audio/service";
import { transcriptOf } from "../../audio/words";
import { audioTasks } from "../../db/schema";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { uuidArg } from "./common";
import { inputFromAsset, requirePro, runTask, waitArg } from "./eleven-common";

const sourceArgs = {
  project_id: uuidArg("project_id"),
  key: z.string().min(1).max(128).describe("Audio or video asset key from assets_list"),
  wait_s: waitArg,
};

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
    name: "audio_transcribe",
    aliases: ["el_stt"],
    title: "Transcribe (Scribe)",
    description:
      "Transcribes a project video/audio (scribe_v2): word timestamps, speakers (diarize), audio events. The panel extracts the audio locally; then read words with transcript_get. Uzbek accuracy tier: Good.",
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
    name: "audio_align",
    aliases: ["el_align"],
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
    name: "audio_isolate",
    aliases: ["el_isolate"],
    title: "Isolate voice",
    description:
      'Removes background noise from a project video/audio, leaving clean speech (new WAV in audio/). quality "standard" (default) runs on our server and is cheap; "pro" uses the premium external service (stronger, also separates speech from music; ~10× the price) — use pro only if the user asked for it or confirmed the price.',
    input: z.object({
      ...sourceArgs,
      quality: z.enum(["standard", "pro"]).default("standard"),
      user_confirmed: z
        .boolean()
        .optional()
        .describe("quality pro: the user accepted the price in this chat"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const basic = input.quality === "standard";
      if (!basic) {
        // Kirish uzunligi oldindan noma'lum: daqiqasiga narx (pro) ma'lumot uchun.
        const allowed = await requirePro(
          ctx,
          "isolate",
          input.user_confirmed,
          quoteAudio("isolate", {}, 60, {}, ctx.app.billing.rates).priceUsd,
        );
        if (!allowed.ok) return allowed;
      }
      const audio = await inputFromAsset(
        ctx,
        input.project_id,
        input.key,
        "audio",
        basic ? { format: "wav", sampleRate: 48_000 } : {},
      );
      if (!audio.ok) return audio;
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "isolate",
          label: `Toza ovoz${basic ? "" : " (pro)"}: ${input.key}`,
          inputs: [audio.data],
          params: basic ? { tier: "basic" } : {},
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "transcript_get",
    title: "Get transcript",
    description:
      "Full transcript of an audio_transcribe / audio_align task: text and words with start/end (and speaker). Edited version if transcript_edit was used.",
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
