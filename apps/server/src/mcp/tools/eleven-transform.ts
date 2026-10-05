/** P4.08: el_voice_change, el_dub, el_voice_design (+ saqlash), el_voice_clone (faqat rozilik bilan). */
import { fail, ok } from "@aes/shared";
import { z } from "zod";
import { cloneVoice, createDesignedVoice } from "../../eleven/voice";
import type { InputFile } from "../../eleven/audio";
import { defineTool } from "../registry";
import { uuidArg } from "./common";
import { direct, inputFromAsset, runTask, waitArg } from "./eleven-common";

const sourceArgs = {
  project_id: uuidArg("project_id"),
  key: z.string().min(1).max(128).describe("Audio or video asset key from assets_list"),
};

export const elevenTransformTools = [
  defineTool({
    name: "el_voice_change",
    title: "Change voice",
    description:
      "Speech-to-speech: re-voices a project recording with another voice, keeping timing and emotion.",
    input: z.object({
      ...sourceArgs,
      voice_id: z.string().min(1).max(64),
      remove_background_noise: z.boolean().default(false),
      wait_s: waitArg,
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
          kind: "voice_change",
          label: `Ovoz almashtirish: ${input.key}`,
          inputs: [audio.data],
          params: {
            voice_id: input.voice_id,
            remove_background_noise: input.remove_background_noise,
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_dub",
    title: "Dub",
    description:
      "Dubs a project video/audio into another language (asynchronous on ElevenLabs, polled up to 30 min). Returns the dubbed audio in audio/. Use wait_s=0 and poll audio_tasks_status for long media.",
    input: z.object({
      ...sourceArgs,
      target_lang: z.string().regex(/^[a-z]{2,3}$/),
      source_lang: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .optional(),
      num_speakers: z.number().int().min(0).max(32).optional(),
      wait_s: waitArg,
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
          kind: "dub",
          label: `Dublyaj (${input.target_lang}): ${input.key}`,
          inputs: [audio.data],
          params: {
            target_lang: input.target_lang,
            ...(input.source_lang === undefined ? {} : { source_lang: input.source_lang }),
            ...(input.num_speakers === undefined ? {} : { num_speakers: input.num_speakers }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_voice_design",
    title: "Design a voice",
    description:
      "Creates voice previews from a description (listen in the panel's Audio screen / audio/). To keep one, call again with save:{generated_voice_id, name} → returns voice_id for el_tts.",
    input: z.object({
      description: z.string().min(20).max(1000),
      text: z
        .string()
        .min(100)
        .max(1000)
        .optional()
        .describe("Preview text (100–1000 chars); auto if omitted"),
      save: z
        .object({
          generated_voice_id: z.string().min(1).max(100),
          name: z.string().min(1).max(100),
        })
        .optional(),
      project_id: uuidArg("project_id").optional(),
      wait_s: waitArg,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      if (input.save !== undefined) {
        const created = await direct(ctx, (client) =>
          createDesignedVoice(client, {
            voice_name: input.save!.name,
            voice_description: input.description,
            generated_voice_id: input.save!.generated_voice_id,
          }),
        );
        if (!created.ok) return created;
        return ok({ voice_id: created.data.voice_id, name: input.save.name });
      }
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "voice_design",
          label: `Ovoz dizayni: ${input.description.slice(0, 40)}`,
          params: {
            voice_description: input.description,
            ...(input.text === undefined ? {} : { text: input.text }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_voice_clone",
    title: "Clone a voice (consent required)",
    description:
      "Instant voice clone from project recordings. ONLY with the voice owner's explicit permission: consent must be true (confirm with the user first). Returns voice_id. Logged in the security journal.",
    input: z.object({
      project_id: uuidArg("project_id"),
      keys: z.array(z.string().min(1).max(128)).min(1).max(10),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      consent: z.literal(true, {
        error:
          "Ovoz klonlash faqat ovoz egasining roziligi bilan: consent: true (foydalanuvchidan tasdiq oling)",
      }),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const files: InputFile[] = [];
      for (const [index, key] of input.keys.entries()) {
        const audio = await inputFromAsset(ctx, input.project_id, key, `sample${index + 1}`);
        if (!audio.ok) return audio;
        const data = await ctx.app.storage.getBytes(audio.data.storage_key);
        if (data === null) return fail("ASSET_MISSING", `Namuna storage'da yo'q: ${key}`);
        files.push({ data, filename: `sample${index + 1}.ogg`, contentType: "audio/ogg" });
      }
      const res = await direct(ctx, (client) =>
        cloneVoice(client, {
          name: input.name,
          files,
          ...(input.description === undefined ? {} : { description: input.description }),
        }),
      );
      if (!res.ok) return res;
      return ok({ ...res.data, name: input.name });
    },
  }),
];
