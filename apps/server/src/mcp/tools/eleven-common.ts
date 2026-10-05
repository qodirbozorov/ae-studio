/** ElevenLabs toollari uchun umumiy yordamchilar: vazifa yuborish (+kutish), asset → kirish audiosi, lug'atlar. */
import { fail, makeError, ok } from "@aes/shared";
import type { AudioKind, Result } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { extractInput } from "../../audio/inputs";
import type { PronunciationLocator } from "../../audio/plan";
import type { InputRef } from "../../audio/service";
import { assets, pronunciationDicts } from "../../db/schema";
import { ElevenError } from "../../eleven/client";
import type { ElevenClient } from "../../eleven/client";
import type { ToolContext, ToolOutput } from "../registry";
import { taskView } from "./audio";
import { ownProject, uuidArg } from "./common";

export const waitArg = z
  .number()
  .int()
  .min(0)
  .max(55)
  .default(30)
  .describe(
    "Seconds to wait for the result (0 = return task_id immediately; poll audio_tasks_status)",
  );

export const projectArg = uuidArg("project_id").describe(
  "Project whose audio/ folder receives the file (optional for pure generation)",
);

/** Vazifani yuboradi va `wait` soniya kutadi. */
export async function runTask(
  ctx: ToolContext,
  input: {
    projectId?: string | undefined;
    kind: AudioKind;
    label: string;
    params: Record<string, unknown>;
    inputs?: InputRef[];
    fresh?: boolean;
  },
  wait: number,
): Promise<ToolOutput> {
  if (input.projectId !== undefined) {
    const project = await ownProject(ctx, input.projectId);
    if (!project.ok) return project;
  }
  const submitted = await ctx.app.audio.submit({
    userId: ctx.userId,
    projectId: input.projectId ?? null,
    kind: input.kind,
    label: input.label,
    params: input.params,
    ...(input.inputs === undefined ? {} : { inputs: input.inputs }),
    ...(input.fresh === undefined ? {} : { fresh: input.fresh }),
  });
  if (!submitted.ok) return submitted;
  const task =
    wait > 0
      ? ((await ctx.app.audio.wait(submitted.data.id, wait * 1000)) ?? submitted.data)
      : submitted.data;
  const view = taskView(task);
  if (task.status === "failed") {
    const error = view.error ?? makeError("SYS_INTERNAL", "Audio vazifa muvaffaqiyatsiz");
    return { ok: false, error: { ...error, details: { task_id: task.id, cause: error.details } } };
  }
  return ok({
    task: view,
    ...(task.status === "done" || task.status === "skipped"
      ? {}
      : { hint: "Hali tayyor emas: audio_tasks_status bilan tekshiring" }),
  });
}

/** Loyiha asset'i (audio yoki video) → panel ovozni ajratadi → storage `audio-in`. */
export async function inputFromAsset(
  ctx: ToolContext,
  projectId: string,
  key: string,
  name = "audio",
): Promise<Result<InputRef>> {
  const project = await ownProject(ctx, projectId);
  if (!project.ok) return project;
  const [asset] = await ctx.app.db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.key, key.replace(/^asset:/, ""))))
    .limit(1);
  if (asset === undefined) return fail("SPEC_UNKNOWN_ASSET", `asset:${key} yo'q (assets_list)`);
  if (asset.kind !== "audio" && asset.kind !== "video") {
    return fail("ASSET_UNSUPPORTED", `Ovoz faqat audio yoki videodan olinadi (${asset.kind})`);
  }
  if (asset.status !== "ok")
    return fail("ASSET_CORRUPT", `asset:${asset.key} holati: ${asset.status}`);
  return extractInput(ctx.app, project.data, asset.localPath, { name });
}

/** User lug'atlari: slug → locator. */
export async function dictionaries(
  ctx: Pick<ToolContext, "app">,
  userId: string,
): Promise<Record<string, PronunciationLocator>> {
  const rows = await ctx.app.db
    .select()
    .from(pronunciationDicts)
    .where(eq(pronunciationDicts.userId, userId));
  return Object.fromEntries(
    rows.map((row) => [
      row.slug,
      { pronunciation_dictionary_id: row.elId, version_id: row.versionId },
    ]),
  );
}

/** To'g'ridan-to'g'ri (navbatsiz) ElevenLabs chaqiruvi: ovozlar, modellar, plan, lug'at, klon. */
export async function direct<T>(
  ctx: ToolContext,
  call: (client: ElevenClient) => Promise<T>,
): Promise<Result<T>> {
  const client = await ctx.app.eleven.client(ctx.userId);
  if (!client.ok) return client;
  try {
    return ok(await call(client.data));
  } catch (error) {
    if (error instanceof ElevenError) return { ok: false, error: error.error };
    throw error;
  }
}
