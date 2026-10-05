/** P4.06: el_dialogue, el_sfx, el_music, el_music_plan. */
import { fail, ok } from "@aes/shared";
import { z } from "zod";
import { clampMusicMs } from "../../audio/plan";
import { musicPlan } from "../../eleven/generate";
import { defineTool } from "../registry";
import { direct, projectArg, runTask, waitArg } from "./eleven-common";

const sectionSchema = z.object({
  section_name: z.string().min(1).max(100),
  positive_local_styles: z.array(z.string().max(200)).max(20).default([]),
  negative_local_styles: z.array(z.string().max(200)).max(20).default([]),
  duration_ms: z.number().int().min(3000).max(120_000),
  lines: z.array(z.string().max(200)).max(30).default([]),
});

const planSchema = z.object({
  positive_global_styles: z.array(z.string().max(200)).max(20).default([]),
  negative_global_styles: z.array(z.string().max(200)).max(20).default([]),
  sections: z.array(sectionSchema).min(1).max(30),
});

export const elevenGenerateTools = [
  defineTool({
    name: "el_dialogue",
    title: "Dialogue",
    description:
      "Multi-voice dialogue (Text to Dialogue, default model eleven_v3) as one audio file.",
    input: z.object({
      lines: z
        .array(z.object({ voice_id: z.string().min(1).max(64), text: z.string().min(1).max(2000) }))
        .min(1)
        .max(200),
      model_id: z.string().max(64).optional(),
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .optional(),
      project_id: projectArg.optional(),
      label: z.string().max(200).optional(),
      fresh: z.boolean().optional(),
      wait_s: waitArg,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "dialogue",
          label: input.label ?? "Dialog",
          fresh: input.fresh,
          params: {
            inputs: input.lines.map((line) => ({ text: line.text, voice_id: line.voice_id })),
            ...(input.model_id === undefined ? {} : { model_id: input.model_id }),
            ...(input.language === undefined ? {} : { language_code: input.language }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_sfx",
    title: "Sound effect",
    description:
      "Generates a sound effect from a description (0.5–30 s; without duration ElevenLabs picks one). Use for transitions, accents, ambience.",
    input: z.object({
      prompt: z.string().min(1).max(500),
      duration_s: z.number().min(0.5).max(30).optional(),
      loop: z.boolean().optional(),
      prompt_influence: z.number().min(0).max(1).optional(),
      project_id: projectArg.optional(),
      label: z.string().max(200).optional(),
      fresh: z.boolean().optional(),
      wait_s: waitArg,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "sfx",
          label: input.label ?? `SFX: ${input.prompt.slice(0, 40)}`,
          fresh: input.fresh,
          params: {
            text: input.prompt,
            ...(input.duration_s === undefined ? {} : { duration_seconds: input.duration_s }),
            ...(input.loop === undefined ? {} : { loop: input.loop }),
            ...(input.prompt_influence === undefined
              ? {}
              : { prompt_influence: input.prompt_influence }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_music",
    title: "Music",
    description:
      "Generates music: either prompt (+ exact duration_s 3–600, instrumental) or a composition_plan from el_music_plan (sections with exact durations). Not both.",
    input: z.object({
      prompt: z.string().min(1).max(2000).optional(),
      duration_s: z.number().min(3).max(600).optional(),
      instrumental: z.boolean().default(true),
      composition_plan: planSchema.optional(),
      project_id: projectArg.optional(),
      label: z.string().max(200).optional(),
      fresh: z.boolean().optional(),
      wait_s: waitArg,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      if ((input.prompt === undefined) === (input.composition_plan === undefined)) {
        return fail("SYS_BAD_REQUEST", "prompt yoki composition_plan dan aynan bittasini bering");
      }
      const params =
        input.composition_plan !== undefined
          ? { composition_plan: input.composition_plan }
          : {
              prompt: input.prompt!,
              force_instrumental: input.instrumental,
              ...(input.duration_s === undefined
                ? {}
                : { music_length_ms: clampMusicMs(input.duration_s) }),
            };
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "music",
          label: input.label ?? "Musiqa",
          fresh: input.fresh,
          params,
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_music_plan",
    title: "Music composition plan",
    description:
      "Creates a music composition plan (global styles + sections with exact durations) from a prompt. Edit it if needed and pass to el_music.composition_plan.",
    input: z.object({
      prompt: z.string().min(1).max(2000),
      duration_s: z.number().min(3).max(600).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      const res = await direct(ctx, (client) =>
        musicPlan(client, {
          prompt: input.prompt,
          ...(input.duration_s === undefined
            ? {}
            : { music_length_ms: clampMusicMs(input.duration_s) }),
        }),
      );
      if (!res.ok) return res;
      return ok({
        plan: res.data,
        duration_s: res.data.sections.reduce((sum, section) => sum + section.duration_ms, 0) / 1000,
      });
    },
  }),
];
