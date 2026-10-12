/**
 * Admin → Musiqa (P9.05, oldinroq): kutubxona ro'yxati, bittalab/ko'p fayl yuklash, tahrirlash, nomzodlarni
 * ko'rib chiqish (candidate → public/hidden), o'chirish. Fayl serverga to'g'ridan-to'g'ri (xom body) —
 * R2 uchun brauzer CORS sozlash shart emas.
 */
import { fail, ok } from "@aes/shared";
import { desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { wavDuration } from "../audio/dfn";
import { audit } from "../audit";
import type { AppContext } from "../context";
import { musicTracks, users } from "../db/schema";
import { trackView } from "../music/library";
import { makeRequireAdmin } from "./auth";

const MAX_BYTES = 60 * 1024 * 1024;
const EXT = new Set(["mp3", "wav", "m4a", "ogg"]);
const statusSchema = z.enum(["candidate", "public", "hidden"]);

const metaSchema = z.object({
  filename: z.string().min(1).max(255),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  description: z.string().max(1000).default(""),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  duration_s: z.number().min(0.5).max(3600),
  bpm: z.number().int().min(20).max(300).nullable().default(null),
  loopable: z.boolean().default(false),
  status: statusSchema.default("public"),
});

const patchSchema = metaSchema
  .pick({ title: true, category: true, description: true, tags: true, bpm: true, loopable: true })
  .partial()
  .extend({ status: statusSchema.optional() });

export function registerAdminMusicRoutes(
  app: FastifyInstance,
  ctx: Pick<AppContext, "env" | "db" | "now" | "storage" | "music">,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  const note = (action: string, data: unknown, ip: string) =>
    audit(ctx, app.log, { userId: null, actor: "admin", action, ip, data });

  app.get("/api/admin/music", { preHandler: requireAdmin }, async (request) => {
    const query = z
      .object({ status: statusSchema.optional(), q: z.string().max(200).optional() })
      .parse(request.query);
    const rows = await ctx.db
      .select({ track: musicTracks, owner: users.name })
      .from(musicTracks)
      .leftJoin(users, eq(users.id, musicTracks.ownerUserId))
      .where(
        query.status === undefined && query.q === undefined
          ? undefined
          : sql`${query.status === undefined ? sql`true` : sql`${musicTracks.status} = ${query.status}`}
              and ${
                query.q === undefined
                  ? sql`true`
                  : sql`(${musicTracks.title} ilike ${`%${query.q}%`} or ${musicTracks.category} ilike ${`%${query.q}%`} or ${musicTracks.description} ilike ${`%${query.q}%`})`
              }`,
      )
      .orderBy(desc(musicTracks.createdAt))
      .limit(300);
    const counts = await ctx.db
      .select({ status: musicTracks.status, n: sql<number>`count(*)::int` })
      .from(musicTracks)
      .groupBy(musicTracks.status);
    return ok({
      tracks: rows.map(({ track, owner }) => ({
        ...trackView(track),
        source: track.source,
        prompt: track.prompt,
        owner,
        size_ext: track.ext,
        created_at: track.createdAt,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  });

  // Xom audio body faqat shu scope'da.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      [
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/mp4",
        "audio/ogg",
        "application/octet-stream",
      ],
      { parseAs: "buffer", bodyLimit: MAX_BYTES },
      (_request, body, done) => done(null, body),
    );
    scope.post(
      "/api/admin/music",
      { preHandler: requireAdmin, bodyLimit: MAX_BYTES },
      async (request, reply) => {
        const raw = (request.query as { meta?: string }).meta;
        let meta: z.infer<typeof metaSchema>;
        try {
          meta = metaSchema.parse(JSON.parse(raw ?? "{}"));
        } catch (error) {
          return reply
            .code(400)
            .send(
              fail(
                "SYS_BAD_REQUEST",
                `meta noto'g'ri: ${error instanceof Error ? error.message : ""}`,
              ),
            );
        }
        const ext = meta.filename.slice(meta.filename.lastIndexOf(".") + 1).toLowerCase();
        if (!EXT.has(ext))
          return reply.code(400).send(fail("ASSET_UNSUPPORTED", "mp3, wav, m4a yoki ogg"));
        const body = request.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
          return reply.code(400).send(fail("SYS_BAD_REQUEST", "Fayl bo'sh"));
        }
        const { row, created } = await ctx.music.add({
          bytes: body,
          ext,
          title: meta.title,
          category: meta.category,
          description: meta.description,
          tags: meta.tags,
          durationS: (ext === "wav" ? wavDuration(body) : null) ?? meta.duration_s,
          bpm: meta.bpm,
          loopable: meta.loopable,
          source: "admin",
          status: meta.status,
        });
        await note("admin.music.add", { id: row.id, title: row.title, created }, request.ip);
        return ok({ track: trackView(row), created });
      },
    );
  });

  app.patch("/api/admin/music/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success || !z.uuid().safeParse(id).success) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "Ma'lumot noto'g'ri"));
    }
    const [row] = await ctx.db
      .update(musicTracks)
      .set({ ...parsed.data, updatedAt: ctx.now() })
      .where(eq(musicTracks.id, id))
      .returning();
    if (row === undefined) return reply.code(404).send(fail("SYS_NOT_FOUND", "Trek topilmadi"));
    await note("admin.music.update", { id, ...parsed.data }, request.ip);
    return ok(trackView(row));
  });

  app.delete("/api/admin/music/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "id"));
    const [row] = await ctx.db.delete(musicTracks).where(eq(musicTracks.id, id)).returning();
    if (row === undefined) return reply.code(404).send(fail("SYS_NOT_FOUND", "Trek topilmadi"));
    await ctx.storage.delete(row.storageKey).catch(() => undefined);
    await note("admin.music.delete", { id, title: row.title }, request.ip);
    return ok({ deleted: true });
  });

  app.get("/api/admin/music/:id/file", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "id"));
    const row = await ctx.music.get(id);
    if (row === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Trek topilmadi"));
    return reply.redirect(await ctx.storage.presignGet(row.storageKey, { ttlS: 600 }));
  });
}
