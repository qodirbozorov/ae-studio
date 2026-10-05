/**
 * Assetlar (§3 INGEST, §5 `assets`): panel `asset.scanned` yuboradi → upsert. Skanda yo'q bo'lganlar `missing`.
 * Thumbnail'lar panel tomonidan pre-signed URL orqali storage'ga yuklanadi (asl fayllar localda qoladi, D5).
 */
import { randomUUID } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { PanelMessageOf } from "@aes/shared";
import { and, eq, notInArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { assets, projects } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import type { DeviceIdentity } from "../devices/routes";
import { normalizeRootPath } from "../projects/routes";
import { storageKey } from "../storage";

type Scanned = PanelMessageOf<"asset.scanned">;

function statusOf(asset: Scanned["assets"][number]): "ok" | "corrupt" | "unsupported" {
  if (asset.error === undefined) return "ok";
  return asset.error.code === "ASSET_UNSUPPORTED" ? "unsupported" : "corrupt";
}

/** `asset.scanned` → `assets` (bir loyiha ichida kalit bo'yicha upsert). */
export async function applyScan(
  ctx: Pick<AppContext, "db" | "now">,
  device: DeviceIdentity,
  message: Scanned,
): Promise<{ projectId: string; count: number } | null> {
  const rootPath = normalizeRootPath(message.project_root);
  if (rootPath === null) return null;
  const [project] = await ctx.db
    .select()
    .from(projects)
    .where(and(eq(projects.deviceId, device.deviceId), eq(projects.rootPath, rootPath)))
    .limit(1);
  if (project === undefined) return null;

  for (const item of message.assets) {
    const values = {
      projectId: project.id,
      key: item.key,
      localPath: item.local_path,
      kind: item.kind,
      meta: { ...item.meta, size: item.size, mtime_ms: item.mtime_ms, error: item.error ?? null },
      thumbUrl: item.thumb_key ?? null,
      hash: item.hash,
      status: statusOf(item),
    };
    await ctx.db
      .insert(assets)
      .values(values)
      .onConflictDoUpdate({
        target: [assets.projectId, assets.key],
        set: { ...values, updatedAt: ctx.now() },
      });
  }
  const keys = message.assets.map((a) => a.key);
  await ctx.db
    .update(assets)
    .set({ status: "missing", updatedAt: ctx.now() })
    .where(
      keys.length > 0
        ? and(eq(assets.projectId, project.id), notInArray(assets.key, keys))
        : eq(assets.projectId, project.id),
    );
  return { projectId: project.id, count: message.assets.length };
}

function present(row: typeof assets.$inferSelect) {
  return {
    key: row.key,
    ref: `asset:${row.key}`,
    local_path: row.localPath,
    kind: row.kind,
    status: row.status,
    meta: row.meta,
    thumb_key: row.thumbUrl,
    hash: row.hash,
    updated_at: row.updatedAt,
  };
}

const uploadSchema = z.strictObject({
  kind: z.enum(["thumbs", "frames", "audio-in"]),
  hash: z.string().min(4).max(200),
  ext: z.enum(["jpg", "png", "opus", "wav", "mp3", "m4a"]),
});

export function registerAssetRoutes(app: FastifyInstance, ctx: AppContext): void {
  const deviceAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    request.device = await authenticateDevice(ctx, request.headers.authorization);
    if (request.device === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
    }
  };

  async function deviceProject(request: FastifyRequest) {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.deviceId, request.device!.deviceId)))
      .limit(1);
    return row ?? null;
  }

  async function userProject(request: FastifyRequest) {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.userId, request.user!.id)))
      .limit(1);
    return row ?? null;
  }

  ctx.hub.onMessage((device, message) => {
    if (message.type !== "asset.scanned") return;
    void applyScan(ctx, device, message).then(
      (res) => app.log.info({ device: device.deviceId, ...res }, "assetlar yangilandi"),
      (error: unknown) => app.log.error({ err: error }, "asset.scanned qayta ishlanmadi"),
    );
  });

  app.post(
    "/api/agent/projects/:id/uploads",
    { preHandler: deviceAuth },
    async (request, reply) => {
      const project = await deviceProject(request);
      if (project === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha topilmadi"));
      const parsed = uploadSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send(fail("SYS_BAD_REQUEST", "kind, hash, ext kerak"));
      const key = storageKey({
        userId: project.userId,
        projectId: project.id,
        kind: parsed.data.kind,
        hash: parsed.data.hash.replace(/[^A-Za-z0-9]/g, "").slice(0, 100),
        ext: parsed.data.ext,
      });
      const contentType = parsed.data.ext === "jpg" ? "image/jpeg" : undefined;
      return ok({ url: await ctx.storage.presignPut(key, { contentType }), storage_key: key });
    },
  );

  app.get("/api/agent/projects/:id/assets", { preHandler: deviceAuth }, async (request, reply) => {
    const project = await deviceProject(request);
    if (project === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha topilmadi"));
    const rows = await ctx.db.select().from(assets).where(eq(assets.projectId, project.id));
    return ok(rows.map(present));
  });

  app.get("/api/projects/:id/assets", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha topilmadi"));
    const rows = await ctx.db.select().from(assets).where(eq(assets.projectId, project.id));
    return ok(rows.map(present));
  });

  /** INGEST'ni boshlash: panelga `assets.scan` (natija `asset.scanned` bilan asinxron keladi). */
  app.post("/api/projects/:id/scan", { preHandler: requireUser }, async (request, reply) => {
    const project = await userProject(request);
    if (project === null || project.deviceId === null) {
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Loyiha topilmadi"));
    }
    const requestId = randomUUID();
    const sent = ctx.hub.send(project.deviceId, {
      type: "assets.scan",
      request_id: requestId,
      project_root: project.rootPath,
    });
    if (!sent) return reply.code(503).send(fail("ENV_AGENT_OFFLINE", "Panel ulanmagan"));
    return ok({ request_id: requestId });
  });
}
