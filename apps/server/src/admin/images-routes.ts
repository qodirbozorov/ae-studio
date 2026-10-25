/**
 * Admin → Rasmlar: Unsplash Access Key (tekshirib, AES-256-GCM bilan `system_settings` ga), soatlik limit holati va
 * loyihalarga olingan rasmlar statistikasi. Kalit hech qachon qaytarilmaydi — faqat `…abcd`.
 */
import { fail, ok } from "@aes/shared";
import { desc, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { stockPhotos } from "../db/schema";
import { makeRequireAdmin } from "./auth";

export function registerAdminImageRoutes(
  app: FastifyInstance,
  ctx: Pick<AppContext, "env" | "db" | "now" | "unsplash"> & Partial<Pick<AppContext, "cluster">>,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  const changed = () => ctx.cluster?.broadcast({ t: "settings", key: "unsplash" });

  const stats = async () => {
    const since = new Date(ctx.now().getTime() - 30 * 24 * 60 * 60 * 1000);
    const [totals] = await ctx.db
      .select({
        total: sql<number>`count(*)::int`,
        last_30d: sql<number>`count(*) filter (where ${stockPhotos.createdAt} >= ${since})::int`,
        untracked: sql<number>`count(*) filter (where ${stockPhotos.downloadTrackedAt} is null)::int`,
      })
      .from(stockPhotos);
    const recent = await ctx.db
      .select({
        photo_id: stockPhotos.photoId,
        author: stockPhotos.author,
        photo_url: stockPhotos.photoUrl,
        created_at: stockPhotos.createdAt,
      })
      .from(stockPhotos)
      .where(gte(stockPhotos.createdAt, since))
      .orderBy(desc(stockPhotos.createdAt))
      .limit(12);
    return { ...totals, recent };
  };

  app.get("/api/admin/unsplash", { preHandler: requireAdmin }, async (request) => {
    const fresh = (request.query as { fresh?: string }).fresh === "1";
    return ok({ ...(await ctx.unsplash.adminView(fresh)), stats: await stats() });
  });

  app.put("/api/admin/unsplash", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = z
      .strictObject({ api_key: z.string().trim().min(20).max(200) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "api_key (Access Key) kerak"));
    const result = await ctx.unsplash.setKey(parsed.data.api_key, "admin");
    if (!result.ok) return reply.code(400).send(result);
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.unsplash.key_set",
      target: result.data.masked,
      ip: request.ip,
    });
    return ok({ ...result.data, stats: await stats() });
  });

  app.delete("/api/admin/unsplash", { preHandler: requireAdmin }, async (request) => {
    const view = await ctx.unsplash.removeKey("admin");
    changed();
    await audit(ctx, request.log, {
      userId: null,
      actor: "admin",
      action: "admin.unsplash.key_removed",
      ip: request.ip,
    });
    return ok({ ...view, stats: await stats() });
  });
}
