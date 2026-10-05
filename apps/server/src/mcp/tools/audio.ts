/**
 * Audio vazifalari holati (§8 `audio_tasks_status`): job, loyiha yoki id'lar bo'yicha.
 * Katta natijalar (alignment, transcript) qisqartiriladi — to'liq transkript `transcript_get` da.
 */
import { ok } from "@aes/shared";
import { z } from "zod";
import { presentTask } from "../../audio/service";
import type { AudioTaskRow } from "../../audio/service";
import { defineTool } from "../registry";
import { uuidArg } from "./common";

export function taskView(task: AudioTaskRow) {
  const result = (task.result ?? {}) as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  if ("transcript" in result) {
    const transcript = result.transcript as { text?: string; language_code?: string };
    summary.text = transcript.text?.slice(0, 500);
    summary.language = transcript.language_code;
  }
  if ("previews" in result) summary.previews = result.previews;
  if ("voice_id" in result) summary.voice_id = result.voice_id;
  if ("dubbing_id" in result) summary.dubbing_id = result.dubbing_id;
  return {
    ...presentTask(task),
    credits: task.credits,
    delivered: task.deliveredAt !== null,
    ...(Object.keys(summary).length === 0 ? {} : { result: summary }),
  };
}

export const audioStatusTools = [
  defineTool({
    name: "audio_tasks_status",
    title: "Audio tasks status",
    description:
      "Status of audio tasks (TTS, music, SFX, STT, dubbing …): queued → running → done | failed | skipped, cached (no credits spent), duration, local file in the project's audio/ folder once the panel downloaded it. Filter by task ids, job or project.",
    input: z.object({
      task_ids: z.array(uuidArg("task_id")).max(50).optional(),
      job_id: uuidArg("job_id").optional(),
      project_id: uuidArg("project_id").optional(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const rows = await ctx.app.audio.list({
        userId: ctx.userId,
        ...(input.task_ids === undefined ? {} : { ids: input.task_ids }),
        ...(input.job_id === undefined ? {} : { jobId: input.job_id }),
        ...(input.project_id === undefined ? {} : { projectId: input.project_id }),
        limit: input.limit,
      });
      return ok(rows.map(taskView));
    },
  }),
];
