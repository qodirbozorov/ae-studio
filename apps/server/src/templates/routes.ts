/**
 * Panel Shablonlar ekrani (P5.06, Claude'siz rejim; qurilma tokeni): galereya va slotlarni to'ldirib ishga tushirish.
 * Ishga tushirish: yangi plan (`created_by: user`) → job (`auto_approve`: VERIFY avtomatik) → Live ekrani kuzatadi.
 */
import { ASPECTS, fail, ok, slugSchema } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { projects } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import type { JobEngine } from "../jobs/engine";
import { applyTemplate, exampleScene, templateSummary } from "./apply";

const runBody = z.object({
  project_id: z.uuid(),
  slots: z.record(
    z.string().regex(/^[a-z0-9_]{1,64}$/),
    z.union([z.string().max(2000), z.number(), z.boolean()]),
  ),
  format: z.enum(ASPECTS).optional(),
  variants: z.array(z.enum(ASPECTS)).max(3).optional(),
  dur: z.number().positive().max(3600).optional(),
  brand: slugSchema.optional(),
  output_name: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
    .optional(),
});

export function registerTemplateRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  engine: JobEngine,
): void {
  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  app.get("/api/agent/templates", { preHandler: deviceAuth }, async (request) => {
    const userId = request.device!.userId;
    const out = [];
    for (const entry of await ctx.templates.list(userId)) {
      const { files: _files, ...manifest } = entry.manifest;
      out.push({
        ...templateSummary(entry, await ctx.templates.previewUrl(entry)),
        manifest,
        example_scene: exampleScene(entry.manifest),
      });
    }
    return ok(out);
  });

  app.post("/api/agent/templates/:slug/run", { preHandler: deviceAuth }, async (request, reply) => {
    const slug = slugSchema.safeParse((request.params as { slug: string }).slug);
    const body = runBody.safeParse(request.body);
    if (!slug.success || !body.success) {
      return reply
        .code(400)
        .send(fail("SYS_BAD_REQUEST", body.success ? "Noto'g'ri slug" : body.error.message));
    }
    const device = request.device!;
    const [project] = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, body.data.project_id), eq(projects.deviceId, device.deviceId)))
      .limit(1);
    if (project === undefined) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha bu qurilmada topilmadi"));
    }
    const entry = await ctx.templates.get(device.userId, slug.data);
    if (entry === null) {
      return reply
        .code(404)
        .send(fail("SPEC_UNKNOWN_TEMPLATE", `'${slug.data}' shabloni topilmadi`));
    }
    const applied = applyTemplate(entry, null, {
      slots: body.data.slots,
      dur: body.data.dur,
      mode: "new",
      aspect: body.data.format,
      outputName: body.data.output_name,
    });
    if (!applied.ok) return reply.code(400).send(applied);
    const spec = {
      ...(applied.data.spec as Record<string, unknown>),
      ...(body.data.brand === undefined ? {} : { brand: body.data.brand }),
      ...(body.data.variants === undefined ? {} : { variants: body.data.variants }),
    };
    const plan = await engine.addPlan(project.id, spec, "user");
    if (!plan.ok) return reply.code(400).send(plan);
    const job = await engine.create({
      projectId: project.id,
      planVersion: plan.data.version,
      autoApprove: true,
    });
    if (!job.ok) return reply.code(job.error.code === "JOB_ACTIVE" ? 409 : 400).send(job);
    return ok({ job_id: job.data.id, plan_version: plan.data.version });
  });
}
