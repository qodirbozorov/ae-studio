/**
 * Shablon toollari (§8, §11.2, P5.02): templates_list, template_get, template_apply, template_save.
 */
import { ASPECTS, fail, ok, parseSpec, slugSchema } from "@aes/shared";
import { z } from "zod";
import { aepPath } from "../../jobs/engine";
import {
  aepManifestFromScene,
  applyTemplate,
  exampleScene,
  recipeFromScene,
  templateSummary,
} from "../../templates/apply";
import { defineTool } from "../registry";
import { ownProject, requireOnline, uuidArg } from "./common";
import { ownJob } from "./build";

const slotValue = z.union([z.string().max(2000), z.number(), z.boolean()]);
const SAVABLE_STATES = new Set(["VERIFY", "RENDER", "REPORT", "DONE"]);

export const templateTools = [
  defineTool({
    name: "templates_list",
    title: "List templates",
    description:
      "Templates available to the user (built-in library + own): slug, title, formats, duration range, slots (type, required, default) and preview_url. Filter by format or tag.",
    input: z.object({
      format: z.enum(ASPECTS).optional(),
      tag: z.string().min(1).max(32).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const entries = (await ctx.app.templates.list(ctx.userId)).filter(
        (entry) =>
          (input.format === undefined || entry.manifest.formats.includes(input.format)) &&
          (input.tag === undefined || (entry.manifest.tags ?? []).includes(input.tag)),
      );
      const out = [];
      for (const entry of entries) {
        out.push(templateSummary(entry, await ctx.app.templates.previewUrl(entry)));
      }
      return ok(out);
    },
  }),

  defineTool({
    name: "template_get",
    title: "Get template",
    description:
      "Full template: slots with types/defaults/limits, duration range, formats, source (recipe = layer recipe, aep = After Effects file) and an example scene to put into a Spec (scene.template + scene.slots).",
    input: z.object({ slug: slugSchema, version: z.number().int().min(1).optional() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const entry = await ctx.app.templates.get(ctx.userId, input.slug, input.version);
      if (entry === null) {
        return fail("SPEC_UNKNOWN_TEMPLATE", `'${input.slug}' shabloni topilmadi (templates_list)`);
      }
      const { files, ...manifest } = entry.manifest;
      return ok({
        ...templateSummary(entry, await ctx.app.templates.previewUrl(entry)),
        manifest,
        has_aep: files?.aep !== undefined,
        example_scene: exampleScene(entry.manifest),
      });
    },
  }),

  defineTool({
    name: "template_apply",
    title: "Apply template",
    description:
      "Fills a template's slots and saves a new plan version: mode 'append' adds the scene to the latest plan (replaces a scene with the same scene_id), mode 'new' starts a fresh Spec in the template's format (or the given one). Slots are validated immediately. Then run preflight → build_start.",
    input: z.object({
      project_id: uuidArg("project_id"),
      slug: slugSchema,
      slots: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), slotValue).default({}),
      dur: z.number().positive().max(3600).optional(),
      scene_id: slugSchema.optional(),
      mode: z.enum(["append", "new"]).default("append"),
      format: z.enum(ASPECTS).optional(),
      output_name: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
        .optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const entry = await ctx.app.templates.get(ctx.userId, input.slug);
      if (entry === null) {
        return fail("SPEC_UNKNOWN_TEMPLATE", `'${input.slug}' shabloni topilmadi (templates_list)`);
      }
      const latest = input.mode === "new" ? null : await ctx.engine.plan(project.data.id);
      const base = latest === null ? null : parseSpec(latest.spec);
      const applied = applyTemplate(entry, base?.ok === true ? base.data : null, {
        slots: input.slots,
        dur: input.dur,
        sceneId: input.scene_id,
        mode: input.mode,
        aspect: input.format,
        outputName: input.output_name,
      });
      if (!applied.ok) return applied;
      const saved = await ctx.engine.addPlan(project.data.id, applied.data.spec, "claude");
      if (!saved.ok) return saved;
      return ok({
        plan_version: saved.data.version,
        scene_id: applied.data.sceneId,
        scenes: saved.data.spec.scenes.map((scene) => scene.id),
        format: saved.data.spec.format,
        next_step: "preflight → build_start",
      });
    },
  }),

  defineTool({
    name: "template_save",
    title: "Save template",
    description:
      "Saves a scene of the project's plan as a reusable template (new version if the slug exists). source 'recipe' (default): the scene's layers become the recipe, layers with an id become slots (text/media). source 'aep': uploads the built .aep of a finished job (VERIFY or later) and uses the scene comp; layers with an id become slots by layer name.",
    input: z.object({
      project_id: uuidArg("project_id"),
      scene_id: slugSchema,
      slug: slugSchema,
      source: z.enum(["recipe", "aep"]).default("recipe"),
      job_id: uuidArg("job_id").optional(),
      plan_version: z.number().int().min(1).optional(),
      title: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
      formats: z.array(z.enum(ASPECTS)).min(1).max(3).optional(),
      duration: z
        .object({ min: z.number().positive().max(3600), max: z.number().positive().max(3600) })
        .optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      let planVersion = input.plan_version;
      let job = null;
      if (input.source === "aep") {
        if (input.job_id === undefined) return fail("SYS_BAD_REQUEST", "aep uchun job_id kerak");
        const found = await ownJob(ctx, input.job_id);
        if (!found.ok) return found;
        if (found.data.projectId !== project.data.id) {
          return fail("SYS_BAD_REQUEST", "Job boshqa loyihaniki");
        }
        if (!SAVABLE_STATES.has(found.data.state) || found.data.aepVersion === null) {
          return fail(
            "SYS_BAD_REQUEST",
            `Job hali qurilmagan (${found.data.state}): VERIFY yoki undan keyin saqlash mumkin`,
          );
        }
        job = found.data;
        planVersion = job.planVersion;
      }
      const plan = await ctx.engine.plan(project.data.id, planVersion);
      if (plan === null) return fail("SYS_NOT_FOUND", "Plan topilmadi (plan_write)");
      const spec = parseSpec(plan.spec);
      if (!spec.ok) return spec;
      const scene = spec.data.scenes.find((s) => s.id === input.scene_id);
      if (scene === undefined) {
        return fail("SYS_NOT_FOUND", `Sahna topilmadi: ${input.scene_id}`, {
          scenes: spec.data.scenes.map((s) => s.id),
        });
      }
      const meta = {
        slug: input.slug,
        title: input.title,
        description: input.description,
        formats: input.formats,
        duration: input.duration,
      };
      if (job === null) {
        const manifest = recipeFromScene(spec.data, scene, meta);
        if (!manifest.ok) return manifest;
        const saved = await ctx.app.templates.save(ctx.userId, manifest.data);
        if (!saved.ok) return saved;
        return ok(templateSummary(saved.data, null));
      }
      const deviceId = requireOnline(ctx, project.data);
      if (!deviceId.ok) return deviceId;
      const manifest = aepManifestFromScene(spec.data, scene, meta);
      if (!manifest.ok) return manifest;
      const file = await ctx.app.templates.uploadFromPanel(
        deviceId.data,
        ctx.userId,
        aepPath(project.data, job.aepVersion!),
        "aep",
      );
      if (!file.ok) return file;
      const saved = await ctx.app.templates.save(ctx.userId, {
        ...manifest.data,
        files: { aep: file.data },
      });
      if (!saved.ok) return saved;
      return ok(templateSummary(saved.data, null));
    },
  }),
];
