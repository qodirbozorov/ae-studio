/**
 * VERIFY (§3, §2.7): frames_capture (AE kadrlari → Claude ko'radi), verify_approve, verify_patch.
 * Q4: patch yangi plan versiyasi va yangi `.aep` vNNN da to'liq qayta quriladi — eski fayl o'zgarmaydi,
 * hech narsa o'chirilmaydi, op to'plami yopiq qoladi. Ko'pi bilan 3 patch, keyin LOOP_PATCH_LIMIT → ask_user.
 */
import { MAIN_COMP } from "@aes/compiler";
import { randomUUID } from "node:crypto";
import { ASPECTS, MAX_PATCHES, fail, makeOp, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { z } from "zod";
import { aepPath } from "../../jobs/engine";
import { applyJsonPatch, jsonPatchSchema } from "../../lib/json-patch";
import { storageKey } from "../../storage";
import { defineTool } from "../registry";
import type { ImageBlock, ToolContext } from "../registry";
import { previewImages } from "./assets";
import { jobView, ownJob } from "./build";
import { ownProject, requireOnline, uuidArg } from "./common";
import type { ProjectRow } from "./common";

const MAX_FRAMES = 8;

/** Ko'p vaqt bo'lsa teng oraliqda `limit` tasi tanlanadi. */
export function sampleTimes(times: readonly number[], limit: number): number[] {
  if (times.length <= limit) return [...times];
  return Array.from(
    { length: limit },
    (_, i) => times[Math.round((i * (times.length - 1)) / (limit - 1))]!,
  );
}

let captureCounter = 0;

const MODAL_PING_MS = 10_000;

interface Captured {
  aepPath: string;
  dir: string;
  stamp: string;
  files: { time: number; path: string }[];
  project: ProjectRow;
  deviceId: string;
}

/**
 * Kadrlar (P6.02): modal tekshiruvi (ping 10 s) → job `.aep` i → `frames.capture` (agent fayllarni diskda
 * kutadi). Xatolar sababi bilan: `AE_MODAL_SUSPECTED`, `FRAME_CAPTURE_FAILED { reason }`.
 */
async function captureFrames(
  ctx: ToolContext,
  jobId: string,
  input: {
    times?: number[] | undefined;
    variant?: (typeof ASPECTS)[number] | undefined;
    limit: number;
  },
): Promise<Result<Captured>> {
  const job = await ownJob(ctx, jobId);
  if (!job.ok) return job;
  if (job.data.state !== "VERIFY" && job.data.state !== "DONE") {
    return fail(
      "JOB_BAD_ACTION",
      `Kadrlar VERIFY yoki DONE holatida olinadi (hozir ${job.data.state})`,
    );
  }
  if (job.data.aepVersion === null) return fail("JOB_BAD_ACTION", "Job hali qurilmagan");
  const project = await ownProject(ctx, job.data.projectId);
  if (!project.ok) return project;
  const deviceId = requireOnline(ctx, project.data);
  if (!deviceId.ok) return deviceId;
  // Panel qayta ulangan bo'lsa papka hali tiklanmagan bo'lishi mumkin (ENV_NO_FOLDER o'rniga ochamiz).
  const folder = await ctx.engine.prepareFolder(job.data);
  if (!folder.ok) return folder;

  let comp = MAIN_COMP;
  if (input.variant !== undefined) {
    const variants = await ctx.engine.variants(job.data.id);
    const found = variants.find((v) => v.aspect === input.variant);
    if (found === undefined) {
      return fail("SYS_BAD_REQUEST", `Bu job'da ${input.variant} varianti yo'q`, {
        variants: variants.map((v) => v.aspect),
      });
    }
    comp = found.mainComp;
  }
  const times = input.times ?? sampleTimes(await ctx.engine.keyTimes(job.data.id), input.limit);
  if (times.length === 0) return fail("SYS_BAD_REQUEST", "times bering (kalit vaqtlar topilmadi)");
  const stamp = `${Date.now().toString(36)}${(++captureCounter).toString(36)}`;

  // Modal oyna: AE evalScript'ga 10 s ichida javob bermasa — aniq sabab (update-technicalguidline §6).
  const ping = await ctx.app.hub.run(
    deviceId.data,
    makeOp("ping", `verify.ping.${stamp}`, 0, {}, { timeout_ms: MODAL_PING_MS }),
    job.data.id,
  );
  if (!ping.ok) {
    if (ping.error.code === "AE_TIMEOUT") {
      return fail(
        "AE_MODAL_SUSPECTED",
        "AE 10 s ichida javob bermadi — ochiq dialog oynasi bormi?",
        { reason: "modal_suspected" },
      );
    }
    return ping;
  }

  const path = aepPath(project.data, job.data.aepVersion);
  // Kadrlar aynan shu job qurgan faylda olinadi (ochiq bo'lsa — reused).
  const opened = await ctx.app.hub.run(
    deviceId.data,
    makeOp("project.open_or_create", `verify.open.${stamp}`, 0, { path }),
    job.data.id,
  );
  if (!opened.ok) return opened;
  const dir = `frames/${job.data.id.slice(0, 8)}-${stamp}`;
  const captured = await ctx.app.hub.run(
    deviceId.data,
    makeOp("frames.capture", `verify.frames.${stamp}`, 0, { comp, times, dir }),
    job.data.id,
  );
  if (!captured.ok) {
    const code = captured.error.code;
    if (code === "AE_NOT_FOUND") {
      return fail("FRAME_CAPTURE_FAILED", captured.error.message ?? "Comp topilmadi", {
        reason: "comp_not_found",
      });
    }
    if (code === "AE_TIMEOUT") {
      return fail("FRAME_CAPTURE_FAILED", captured.error.message ?? "Kadrlar vaqtida yozilmadi", {
        reason: "timeout",
      });
    }
    return captured;
  }
  return ok({
    aepPath: path,
    dir,
    stamp,
    files: (captured.data.info?.files ?? []) as { time: number; path: string }[],
    project: project.data,
    deviceId: deviceId.data,
  });
}

function timeLabel(time: number): string {
  return `${time.toFixed(2)} s`;
}

const SHEET_TIMEOUT_MS = 90_000;

export const verifyTools = [
  defineTool({
    name: "frames_capture",
    title: "Capture frames",
    description:
      'Renders still frames of the built video (main composition) in After Effects and shows them to you as separate images. Default times = the key moments of the plan, max 8. Prefer contact_sheet (one grid image, faster to read). With spec.variants, pass variant (e.g. "16:9") to check that format too.',
    input: z.object({
      job_id: uuidArg("job_id"),
      times: z.array(z.number().min(0).max(36_000)).min(1).max(MAX_FRAMES).optional(),
      max_px: z.number().int().min(128).max(1280).default(768),
      /** Format varianti (spec.variants dan, masalan "16:9"); berilmasa asosiy format. */
      variant: z.enum(ASPECTS).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const captured = await captureFrames(ctx, input.job_id, {
        times: input.times,
        variant: input.variant,
        limit: MAX_FRAMES,
      });
      if (!captured.ok) return captured;
      const { files, project, dir } = captured.data;
      const images: ImageBlock[] = [];
      const frames: { time: number; path: string; shown: boolean }[] = [];
      for (const file of files) {
        const preview = await previewImages(ctx, project, file.path, {
          mode: "image",
          maxPx: input.max_px,
        });
        if (!preview.ok) return preview;
        const image = preview.data.images[0];
        if (image !== undefined) images.push(image);
        frames.push({ time: file.time, path: file.path, shown: image !== undefined });
      }
      await ctx.engine.note(
        input.job_id,
        "info",
        "verify.frames",
        `VERIFY: ${frames.length} kadr olindi`,
        { times: frames.map((f) => f.time), dir },
      );
      return {
        ok: true,
        data: {
          aep_path: captured.data.aepPath,
          frames,
          hint: "Kadrlar tartibda: har biri yuqoridagi vaqtga mos. Brief bilan solishtiring.",
        },
        images,
      };
    },
  }),

  defineTool({
    name: "contact_sheet",
    title: "Contact sheet",
    description:
      'One grid image of the built video for VERIFY: each cell is a frame with its time written under it. times "auto" (default) = the key moments of the plan (scene hits, transitions, end). Faster and cheaper to read than separate frames. grid "3x2" = 3 columns x 2 rows. With spec.variants, pass variant.',
    input: z.object({
      job_id: uuidArg("job_id"),
      times: z
        .union([z.literal("auto"), z.array(z.number().min(0).max(36_000)).min(1).max(24)])
        .default("auto"),
      max_px: z.number().int().min(128).max(1280).default(540).describe("Cell width in pixels"),
      grid: z
        .string()
        .regex(/^[1-6]x[1-4]$/)
        .default("3x2")
        .describe("columns x rows"),
      variant: z.enum(ASPECTS).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const [cols, rows] = input.grid.split("x").map(Number) as [number, number];
      const limit = cols * rows;
      const captured = await captureFrames(ctx, input.job_id, {
        times: input.times === "auto" ? undefined : input.times.slice(0, limit),
        variant: input.variant,
        limit,
      });
      if (!captured.ok) return captured;
      const { files, project, deviceId, dir } = captured.data;
      const key = storageKey({
        userId: project.userId,
        projectId: project.id,
        kind: "frames",
        hash: `s${randomUUID().replace(/-/g, "")}`,
        ext: "jpg",
      });
      const reply = await ctx.app.hub.request(
        deviceId,
        {
          type: "frames.sheet.request",
          request_id: randomUUID(),
          files: files.map((f) => f.path),
          labels: files.map((f) => timeLabel(f.time)),
          cols: Math.min(cols, files.length),
          cell_px: input.max_px,
          save_as: `${dir}/contact_sheet.jpg`,
          upload: {
            url: await ctx.app.storage.presignPut(key, { contentType: "image/jpeg" }),
            storage_key: key,
          },
        },
        SHEET_TIMEOUT_MS,
      );
      if (!reply.ok) return reply;
      if (reply.data.type !== "file.uploaded") return fail("SYS_INTERNAL", "Kutilmagan javob");
      const bytes = await ctx.app.storage.getBytes(key);
      if (bytes === null) {
        return fail("FRAME_CAPTURE_FAILED", "Contact sheet storage'da yo'q", {
          reason: "render_error",
        });
      }
      await ctx.engine.note(
        input.job_id,
        "info",
        "verify.contact_sheet",
        `VERIFY: contact sheet (${files.length} kadr)`,
        { times: files.map((f) => f.time), dir },
      );
      const usedCols = Math.min(cols, files.length);
      return {
        ok: true,
        data: {
          aep_path: captured.data.aepPath,
          grid: `${usedCols}x${Math.ceil(files.length / usedCols)}`,
          frames: files.map((f, i) => ({ index: i + 1, time: f.time, path: f.path })),
          sheet_path: `${dir}/contact_sheet.jpg`,
          hint: "Kataklar chapdan o'ngga, yuqoridan pastga; ostida vaqt. Brief bilan solishtiring, so'ng verify_approve yoki verify_patch.",
        },
        images: [{ type: "image", data: bytes.toString("base64"), mimeType: "image/jpeg" }],
      };
    },
  }),

  defineTool({
    name: "verify_approve",
    title: "Approve result",
    description:
      "Approves the build once the user is satisfied with it in the After Effects timeline. By default it does NOT render: the job finishes (REPORT → DONE) and the .aep stays in the user's AE. Rendering is heavy for the user's computer — pass render: true only if the user explicitly asked to render in this conversation, together with user_confirmed: true.",
    input: z.object({
      job_id: uuidArg("job_id"),
      render: z
        .boolean()
        .default(false)
        .describe("Render after approval (only when the user explicitly asked)"),
      user_confirmed: z
        .boolean()
        .default(false)
        .describe("The user explicitly allowed rendering in this conversation"),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      if (input.render && !input.user_confirmed) {
        return fail(
          "RENDER_NOT_CONFIRMED",
          "Render faqat foydalanuvchi aniq ruxsat berganda (user_confirmed: true)",
        );
      }
      const res = await ctx.engine.act(job.data.id, "approve", { render: input.render });
      if (!res.ok) return res;
      return ok(await jobView(ctx, res.data, 5));
    },
  }),

  defineTool({
    name: "verify_patch",
    title: "Patch and rebuild",
    description:
      "Fixes the video during VERIFY (or a BLOCKED job): give either a full corrected spec or an RFC 6902 JSON patch against the job's current plan. Saves a new plan version and rebuilds into a NEW .aep version (the previous file is kept). Max 3 patches per job; after that LOOP_PATCH_LIMIT → ask the user.",
    input: z
      .object({
        job_id: uuidArg("job_id"),
        spec: z.record(z.string(), z.unknown()).optional(),
        patch: jsonPatchSchema.optional(),
        reason: z.string().max(500).optional().describe("What was wrong (goes to the job log)"),
      })
      .refine((value) => (value.spec === undefined) !== (value.patch === undefined), {
        error: "spec yoki patch dan bittasini bering",
      }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      let spec: unknown = input.spec;
      if (input.patch !== undefined) {
        const base = await ctx.engine.plan(job.data.projectId, job.data.planVersion);
        if (base === null) return fail("SYS_NOT_FOUND", "Job plani topilmadi");
        const patched = applyJsonPatch(base.spec, input.patch);
        if (!patched.ok) return patched;
        spec = patched.data;
      }
      const res = await ctx.engine.act(job.data.id, "patch", { spec });
      if (!res.ok) return res;
      if (input.reason !== undefined) {
        await ctx.engine.note(
          job.data.id,
          "info",
          "verify.reason",
          `Patch sababi: ${input.reason}`,
        );
      }
      return ok({
        ...(await jobView(ctx, res.data, 5)),
        patches_left: Math.max(0, MAX_PATCHES - res.data.patchCount),
      });
    },
  }),
];
