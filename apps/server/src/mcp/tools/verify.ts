/**
 * VERIFY (§3, §2.7): frames_capture (AE kadrlari → Claude ko'radi), verify_approve, verify_patch.
 * Q4: patch yangi plan versiyasi va yangi `.aep` vNNN da to'liq qayta quriladi — eski fayl o'zgarmaydi,
 * hech narsa o'chirilmaydi, op to'plami yopiq qoladi. Ko'pi bilan 3 patch, keyin LOOP_PATCH_LIMIT → ask_user.
 */
import { MAIN_COMP } from "@aes/compiler";
import { MAX_PATCHES, fail, makeOp, ok } from "@aes/shared";
import { z } from "zod";
import { aepPath } from "../../jobs/engine";
import { applyJsonPatch, jsonPatchSchema } from "../../lib/json-patch";
import { defineTool } from "../registry";
import type { ImageBlock } from "../registry";
import { previewImages } from "./assets";
import { jobView, ownJob } from "./build";
import { ownProject, requireOnline, uuidArg } from "./common";

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

export const verifyTools = [
  defineTool({
    name: "frames_capture",
    title: "Capture frames",
    description:
      "Renders still frames of the built video (main composition) in After Effects and shows them to you as images. Default times = the plan's key moments (scene middles and transitions), max 8. Use during VERIFY to check the result against the brief before verify_approve / verify_patch.",
    input: z.object({
      job_id: uuidArg("job_id"),
      times: z.array(z.number().min(0).max(36_000)).min(1).max(MAX_FRAMES).optional(),
      max_px: z.number().int().min(128).max(1280).default(768),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
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

      const times = input.times ?? sampleTimes(await ctx.engine.keyTimes(job.data.id), MAX_FRAMES);
      if (times.length === 0)
        return fail("SYS_BAD_REQUEST", "times bering (kalit vaqtlar topilmadi)");
      const stamp = `${Date.now().toString(36)}${(++captureCounter).toString(36)}`;
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
        makeOp("frames.capture", `verify.frames.${stamp}`, 0, { comp: MAIN_COMP, times, dir }),
        job.data.id,
      );
      if (!captured.ok) return captured;
      const files = (captured.data.info?.files ?? []) as { time: number; path: string }[];

      const images: ImageBlock[] = [];
      const frames: { time: number; path: string; shown: boolean }[] = [];
      for (const file of files) {
        const preview = await previewImages(ctx, project.data, file.path, {
          mode: "image",
          maxPx: input.max_px,
        });
        if (!preview.ok) return preview;
        const image = preview.data.images[0];
        if (image !== undefined) images.push(image);
        frames.push({ time: file.time, path: file.path, shown: image !== undefined });
      }
      await ctx.engine.note(
        job.data.id,
        "info",
        "verify.frames",
        `VERIFY: ${frames.length} kadr olindi`,
        {
          times: frames.map((f) => f.time),
          dir,
        },
      );
      return {
        ok: true,
        data: {
          aep_path: path,
          frames,
          hint: "Kadrlar tartibda: har biri yuqoridagi vaqtga mos. Brief bilan solishtiring.",
        },
        images,
      };
    },
  }),

  defineTool({
    name: "verify_approve",
    title: "Approve result",
    description:
      "Approves the built video after checking its frames. The job continues to RENDER and REPORT; poll job_status, then report_get.",
    input: z.object({ job_id: uuidArg("job_id") }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const job = await ownJob(ctx, input.job_id);
      if (!job.ok) return job;
      const res = await ctx.engine.act(job.data.id, "approve");
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
