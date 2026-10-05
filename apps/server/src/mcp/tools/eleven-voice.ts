/**
 * P4.05: el_tts (so'z vaqtlari bilan), el_voices, el_models, el_pronunciation, el_usage, el_estimate.
 */
import { AUDIO_KINDS, fail, ok, parseSpec } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { estimateCredits } from "../../audio/estimate";
import { DEFAULT_TTS_MODEL, planAudioTasks } from "../../audio/plan";
import { assets, pronunciationDicts } from "../../db/schema";
import { createDictionary, listModels, listVoices } from "../../eleven/voice";
import type { PronunciationRule } from "../../eleven/voice";
import { defineTool } from "../registry";
import type { ToolContext } from "../registry";
import { ownProject, uuidArg } from "./common";
import { dictionaries, direct, projectArg, runTask, waitArg } from "./eleven-common";

const voiceSettings = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    speed: z.number().min(0.7).max(1.2).optional(),
    use_speaker_boost: z.boolean().optional(),
  })
  .strict();

/** Kredit bahosi va kvota bilan solishtirish; oshsa ask_user. */
export async function estimateWithQuota(
  ctx: ToolContext,
  items: {
    kind: (typeof AUDIO_KINDS)[number];
    label: string;
    params: Record<string, unknown>;
    inputSeconds?: number | null;
  }[],
) {
  const rows = items.map((item) => ({
    label: item.label,
    kind: item.kind,
    credits: estimateCredits({
      kind: item.kind,
      params: item.params,
      inputSeconds: item.inputSeconds ?? null,
    }),
  }));
  const total = rows.reduce((sum, row) => sum + row.credits, 0);
  const account = await ctx.app.eleven.account(ctx.userId);
  const fits = account.remaining === null ? null : total <= account.remaining;
  return {
    items: rows,
    total,
    remaining: account.remaining,
    fits,
    approximate: true,
    ...(fits === false
      ? {
          ask_user: true,
          hint: "Taxminiy narx qolgan kvotadan oshadi: foydalanuvchidan tasdiq so'rang yoki rejani qisqartiring",
        }
      : {}),
  };
}

export const elevenVoiceTools = [
  defineTool({
    name: "el_tts",
    title: "Text to speech",
    description:
      "Generates speech with ElevenLabs (with per-character timestamps for subtitles and TTS-first timing). Default model eleven_v4 (the only family that supports Uzbek). The file is stored on the server and downloaded into the project's audio/ folder. Same parameters → cached, no credits.",
    input: z.object({
      text: z.string().min(1).max(10_000),
      voice_id: z.string().min(1).max(64).describe("From el_voices"),
      model_id: z.string().max(64).optional(),
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .optional()
        .describe("ISO 639-1/3, e.g. uz"),
      voice_settings: voiceSettings.optional(),
      pronunciation: z
        .array(z.string().max(64))
        .max(10)
        .optional()
        .describe("Dictionary slugs from el_pronunciation"),
      project_id: projectArg.optional(),
      label: z.string().max(200).optional(),
      fresh: z.boolean().optional().describe("Bypass cache (regenerate)"),
      wait_s: waitArg,
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      const dicts = await dictionaries(ctx, ctx.userId);
      const missing = (input.pronunciation ?? []).filter((slug) => dicts[slug] === undefined);
      if (missing.length > 0)
        return fail("SYS_NOT_FOUND", `Lug'at topilmadi: ${missing.join(", ")}`);
      return runTask(
        ctx,
        {
          projectId: input.project_id,
          kind: "tts",
          label: input.label ?? "TTS",
          fresh: input.fresh,
          params: {
            voice_id: input.voice_id,
            text: input.text,
            model_id: input.model_id ?? DEFAULT_TTS_MODEL,
            ...(input.language === undefined ? {} : { language_code: input.language }),
            ...(input.voice_settings === undefined ? {} : { voice_settings: input.voice_settings }),
            ...((input.pronunciation ?? []).length === 0
              ? {}
              : {
                  pronunciation_dictionary_locators: input.pronunciation!.map(
                    (slug) => dicts[slug],
                  ),
                }),
          },
        },
        input.wait_s,
      );
    },
  }),

  defineTool({
    name: "el_voices",
    title: "List voices",
    description:
      "Lists ElevenLabs voices available to the user (premade, cloned, designed). Use voice_id in el_tts / spec voiceover.",
    input: z.object({ search: z.string().max(100).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      const res = await direct(ctx, (client) =>
        listVoices(client, input.search === undefined ? {} : { search: input.search }),
      );
      if (!res.ok) return res;
      return ok(
        res.data.map((voice) => ({
          voice_id: voice.voice_id,
          name: voice.name,
          category: voice.category ?? null,
          labels: voice.labels ?? {},
        })),
      );
    },
  }),

  defineTool({
    name: "el_models",
    title: "List models",
    description:
      "Lists ElevenLabs models with supported languages. For Uzbek TTS use eleven_v4 / eleven_v4_turbo; STT: scribe_v2.",
    input: z.object({
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      const res = await direct(ctx, (client) => listModels(client));
      if (!res.ok) return res;
      const models = res.data
        .filter(
          (model) =>
            input.language === undefined ||
            (model.languages ?? []).some((lang) => lang.language_id === input.language),
        )
        .map((model) => ({
          model_id: model.model_id,
          name: model.name,
          tts: model.can_do_text_to_speech ?? null,
          languages: (model.languages ?? []).map((lang) => lang.language_id),
        }));
      return ok({ models, note: "O'zbekcha TTS: eleven_v4 / eleven_v4_turbo (Q7)" });
    },
  }),

  defineTool({
    name: "el_pronunciation",
    title: "Pronunciation dictionary",
    description:
      "Creates or replaces a pronunciation dictionary (brand names, Uzbek words) under a slug; reference it in spec voiceover.pronunciation or el_tts. Without rules → lists saved dictionaries.",
    input: z.object({
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
        .optional(),
      rules: z
        .array(
          z.union([
            z
              .object({ word: z.string().min(1).max(100), alias: z.string().min(1).max(200) })
              .strict(),
            z
              .object({
                word: z.string().min(1).max(100),
                phoneme: z.string().min(1).max(200),
                alphabet: z.enum(["ipa", "cmu-arpabet"]).default("ipa"),
              })
              .strict(),
          ]),
        )
        .min(1)
        .max(500)
        .optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async handler(ctx, input) {
      if (input.rules === undefined || input.slug === undefined) {
        const rows = await ctx.app.db
          .select()
          .from(pronunciationDicts)
          .where(eq(pronunciationDicts.userId, ctx.userId));
        return ok(rows.map((row) => ({ slug: row.slug, rules: row.rules, el_id: row.elId })));
      }
      const rules: PronunciationRule[] = input.rules.map((rule) =>
        "alias" in rule
          ? { type: "alias", string_to_replace: rule.word, alias: rule.alias }
          : {
              type: "phoneme",
              string_to_replace: rule.word,
              phoneme: rule.phoneme,
              alphabet: rule.alphabet,
            },
      );
      const created = await direct(ctx, (client) =>
        createDictionary(client, { name: `aes-${input.slug}`, rules, description: "AE Studio" }),
      );
      if (!created.ok) return created;
      const values = {
        elId: created.data.id,
        versionId: created.data.version_id,
        rules: input.rules,
        updatedAt: ctx.app.now(),
      };
      await ctx.app.db
        .insert(pronunciationDicts)
        .values({ userId: ctx.userId, slug: input.slug, ...values })
        .onConflictDoUpdate({
          target: [pronunciationDicts.userId, pronunciationDicts.slug],
          set: values,
        });
      return ok({ slug: input.slug, rules: input.rules.length, el_id: created.data.id });
    },
  }),

  defineTool({
    name: "el_usage",
    title: "ElevenLabs usage",
    description: "ElevenLabs plan, used and remaining characters/credits, reset date.",
    input: z.object({}),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx) {
      const account = await ctx.app.eleven.account(ctx.userId);
      if (!account.configured) {
        return fail("EL_AUTH", "ElevenLabs kaliti kiritilmagan: kabinet → Sozlamalar → ElevenLabs");
      }
      return ok(account);
    },
  }),

  defineTool({
    name: "el_estimate",
    title: "Estimate credits",
    description:
      "Approximate ElevenLabs credits for a plan's audio (project_id + optional plan_version) or for given items, compared to the remaining quota. If it does not fit → ask_user: true (ask before spending).",
    input: z.object({
      project_id: uuidArg("project_id").optional(),
      plan_version: z.number().int().min(1).optional(),
      items: z
        .array(
          z.object({
            kind: z.enum(AUDIO_KINDS),
            params: z.record(z.string(), z.unknown()),
            input_seconds: z.number().min(0).optional(),
          }),
        )
        .max(100)
        .optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
    async handler(ctx, input) {
      if (input.items !== undefined) {
        return ok(
          await estimateWithQuota(
            ctx,
            input.items.map((item) => ({
              kind: item.kind,
              label: item.kind,
              params: item.params,
              inputSeconds: item.input_seconds ?? null,
            })),
          ),
        );
      }
      if (input.project_id === undefined)
        return fail("SYS_BAD_REQUEST", "project_id yoki items kerak");
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const plan = await ctx.engine.plan(project.data.id, input.plan_version);
      if (plan === null) return fail("SYS_NOT_FOUND", "Plan topilmadi");
      const spec = parseSpec(plan.spec);
      if (!spec.ok) return spec;
      const items = planAudioTasks(spec.data, {
        videoDuration: null,
        dictionaries: await dictionaries(ctx, ctx.userId),
      });
      const sources = await ctx.app.db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, project.data.id)));
      const seconds = (key?: string) => {
        const meta = sources.find((row) => row.key === key)?.meta as
          { duration?: number } | undefined;
        return typeof meta?.duration === "number" ? meta.duration : null;
      };
      return ok(
        await estimateWithQuota(
          ctx,
          items.map((item) => ({ ...item, inputSeconds: seconds(item.inputAsset) })),
        ),
      );
    },
  }),
];
