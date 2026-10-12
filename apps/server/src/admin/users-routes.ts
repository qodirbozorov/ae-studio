/**
 * Admin → Foydalanuvchilar (P9.02–P9.03): ro'yxat va qidiruv, profil (balans, sarf, qurilmalar, joblar,
 * ulangan ilovalar, sessiyalar), balansni to'ldirish (tarif yoki erkin summa), bloklash va sessiyalarni bekor qilish.
 */
import { fail, microsToUsd, ok } from "@aes/shared";
import { and, count, desc, eq, gt, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import { blockUser, revokeUserTokens, unblockUser } from "../auth/revoke";
import { displayName } from "../auth/session";
import type { TariffService } from "../billing/tariffs";
import type { AppContext } from "../context";
import {
  devices,
  jobs,
  oauthClients,
  oauthTokens,
  projects,
  telegramLinks,
  usageLedger,
  users,
} from "../db/schema";
import { makeRequireAdmin } from "./auth";

const PAGE = 50;

const listQuery = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["all", "active", "inactive", "blocked"]).default("all"),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const topupSchema = z
  .strictObject({
    /** Erkin summa (PAYG yoki tuzatish: manfiy). Tarif berilsa — tarif krediti. */
    usd: z.number().finite().min(-100_000).max(100_000).optional(),
    tariff_id: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.usd === undefined) !== (v.tariff_id === undefined), {
    message: "usd yoki tariff_id (bittasi)",
  })
  .refine((v) => v.usd === undefined || v.usd !== 0, { message: "usd 0 bo'lmasin" });

const blockSchema = z.strictObject({ reason: z.string().trim().max(500).optional() });

export function registerAdminUserRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  tariffService: TariffService,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  const note = (action: string, userId: string | null, data: unknown, ip: string) =>
    audit(ctx, app.log, { userId, actor: "admin", action, ip, data });
  const by = () => `admin:${ctx.env.ADMIN_LOGIN ?? "?"}`;

  const userById = async (id: string) => {
    if (!z.uuid().safeParse(id).success) return null;
    const [row] = await ctx.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  };

  app.get("/api/admin/users", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "q/status/offset"));
    const { q, status, offset } = parsed.data;
    const where = [];
    if (q !== undefined && q !== "") {
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(
          ilike(users.name, like),
          ilike(users.email, like),
          ilike(users.telegramId, like),
          sql`${users.id}::text = ${q}`,
        )!,
      );
    }
    if (status === "blocked") where.push(sql`${users.blockedAt} is not null`);
    if (status === "active")
      where.push(sql`${users.activatedAt} is not null and ${users.blockedAt} is null`);
    if (status === "inactive")
      where.push(sql`${users.activatedAt} is null and ${users.blockedAt} is null`);
    const filter = where.length === 0 ? undefined : and(...where);
    const rows = await ctx.db
      .select()
      .from(users)
      .where(filter)
      .orderBy(desc(users.createdAt))
      .limit(PAGE + 1)
      .offset(offset);
    const page = rows.slice(0, PAGE);
    const ids = page.map((row) => row.id);
    const seen =
      ids.length === 0
        ? []
        : await ctx.db
            .select({ userId: devices.userId, lastSeen: max(devices.lastSeenAt), n: count() })
            .from(devices)
            .where(and(inArray(devices.userId, ids), isNull(devices.revokedAt)))
            .groupBy(devices.userId);
    const byUser = new Map(seen.map((row) => [row.userId, row]));
    const [total] = await ctx.db.select({ n: count() }).from(users).where(filter);
    return ok({
      total: total?.n ?? 0,
      offset,
      next_offset: rows.length > PAGE ? offset + PAGE : null,
      users: page.map((row) => ({
        id: row.id,
        name: displayName(row),
        telegram_id: row.telegramId,
        email: row.email,
        balance_usd: microsToUsd(row.balanceMicros),
        activated: row.activatedAt !== null,
        blocked: row.blockedAt !== null,
        devices: byUser.get(row.id)?.n ?? 0,
        last_seen_at: byUser.get(row.id)?.lastSeen ?? null,
        created_at: row.createdAt,
      })),
    });
  });

  app.get("/api/admin/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const user = await userById((request.params as { id: string }).id);
    if (user === null)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Foydalanuvchi topilmadi"));
    const now = ctx.now();
    const [account, history, owned, recentJobs, apps, sessions, telegram, totals] =
      await Promise.all([
        ctx.billing.account(user.id),
        ctx.billing.history(user.id, 100),
        ctx.db
          .select()
          .from(devices)
          .where(eq(devices.userId, user.id))
          .orderBy(desc(devices.createdAt)),
        ctx.db
          .select({
            id: jobs.id,
            project: projects.name,
            state: jobs.state,
            outcome: jobs.outcome,
            created_at: jobs.createdAt,
            updated_at: jobs.updatedAt,
          })
          .from(jobs)
          .innerJoin(projects, eq(projects.id, jobs.projectId))
          .where(eq(projects.userId, user.id))
          .orderBy(desc(jobs.createdAt))
          .limit(30),
        ctx.db
          .select({
            client_id: oauthTokens.clientId,
            name: oauthClients.clientName,
            last: max(oauthTokens.createdAt),
          })
          .from(oauthTokens)
          .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
          .where(
            and(
              eq(oauthTokens.userId, user.id),
              inArray(oauthTokens.kind, ["access", "refresh"]),
              isNull(oauthTokens.revokedAt),
              or(isNull(oauthTokens.expiresAt), gt(oauthTokens.expiresAt, now)),
            ),
          )
          .groupBy(oauthTokens.clientId, oauthClients.clientName),
        ctx.db
          .select({ n: count() })
          .from(oauthTokens)
          .where(
            and(
              eq(oauthTokens.userId, user.id),
              eq(oauthTokens.kind, "session"),
              isNull(oauthTokens.revokedAt),
              gt(oauthTokens.expiresAt, now),
            ),
          ),
        ctx.db
          .select({ chat: telegramLinks.chatTitle, linkedAt: telegramLinks.linkedAt })
          .from(telegramLinks)
          .where(eq(telegramLinks.userId, user.id)),
        ctx.db
          .select({
            kind: usageLedger.kind,
            amount: sql<string>`coalesce(sum(${usageLedger.amountMicros}), 0)`,
            cost: sql<string>`coalesce(sum(${usageLedger.costMicros}), 0)`,
          })
          .from(usageLedger)
          .where(eq(usageLedger.userId, user.id))
          .groupBy(usageLedger.kind),
      ]);
    const sum = (kind: string, field: "amount" | "cost") =>
      microsToUsd(Number(totals.find((row) => row.kind === kind)?.[field] ?? 0));
    return ok({
      id: user.id,
      name: displayName(user),
      telegram_id: user.telegramId,
      email: user.email,
      created_at: user.createdAt,
      blocked_at: user.blockedAt,
      blocked_reason: user.blockedReason,
      prefs: user.prefs,
      account,
      totals: {
        topup_usd: sum("topup", "amount"),
        adjust_usd: sum("adjust", "amount"),
        spent_usd: -sum("charge", "amount"),
        cost_usd: sum("charge", "cost"),
      },
      devices: owned.map((d) => ({
        id: d.id,
        name: d.name,
        os: d.os,
        ae_version: d.aeVersion,
        last_seen_at: d.lastSeenAt,
        revoked: d.revokedAt !== null,
        online: d.revokedAt === null && ctx.hub.isOnline(d.id),
      })),
      jobs: recentJobs,
      apps: apps.map((a) => ({ client_id: a.client_id, name: a.name, last_at: a.last })),
      sessions: sessions[0]?.n ?? 0,
      telegram:
        telegram[0] === undefined
          ? null
          : { chat: telegram[0].chat, linked_at: telegram[0].linkedAt },
      history: history.map((row) => ({
        id: row.id,
        kind: row.kind,
        item: row.item,
        quantity: row.quantity,
        unit: row.unit,
        amount_usd: microsToUsd(row.amountMicros),
        cost_usd: microsToUsd(row.costMicros),
        cached: row.cached,
        job_id: row.jobId,
        note: row.note,
        created_by: row.createdBy,
        created_at: row.createdAt,
      })),
    });
  });

  app.post("/api/admin/users/:id/topup", { preHandler: requireAdmin }, async (request, reply) => {
    const user = await userById((request.params as { id: string }).id);
    if (user === null)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Foydalanuvchi topilmadi"));
    const parsed = topupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send(fail("SYS_BAD_REQUEST", parsed.error.issues[0]?.message ?? "usd yoki tariff_id"));
    }
    let usd = parsed.data.usd ?? 0;
    let text = parsed.data.note ?? null;
    let tariffId: string | null = null;
    if (parsed.data.tariff_id !== undefined) {
      const tariff = await tariffService.get(parsed.data.tariff_id);
      if (tariff === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Tarif topilmadi"));
      usd = microsToUsd(tariff.creditMicros);
      tariffId = tariff.id;
      const paid = `Tarif «${tariff.name}» — to'lov ${microsToUsd(tariff.priceMicros)} $`;
      text = text === null || text === "" ? paid : `${paid}. ${text}`;
    }
    const account = await ctx.billing.topup(user.id, usd, by(), text ?? undefined, { tariffId });
    await note("admin.user.topup", user.id, { usd, tariff_id: tariffId, note: text }, request.ip);
    return ok(account);
  });

  app.post("/api/admin/users/:id/block", { preHandler: requireAdmin }, async (request, reply) => {
    const user = await userById((request.params as { id: string }).id);
    if (user === null)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Foydalanuvchi topilmadi"));
    const parsed = blockSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "reason"));
    const result = await blockUser(ctx.db, user.id, parsed.data.reason ?? null, ctx.now());
    for (const deviceId of result?.deviceIds ?? []) ctx.hub.kick(deviceId, "Hisob bloklangan");
    await note(
      "admin.user.block",
      user.id,
      { reason: parsed.data.reason ?? null, revoked: result?.revoked },
      request.ip,
    );
    return ok({ blocked: true, revoked: result?.revoked ?? 0 });
  });

  app.post("/api/admin/users/:id/unblock", { preHandler: requireAdmin }, async (request, reply) => {
    const user = await userById((request.params as { id: string }).id);
    if (user === null)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Foydalanuvchi topilmadi"));
    await unblockUser(ctx.db, user.id);
    await note("admin.user.unblock", user.id, null, request.ip);
    return ok({ blocked: false });
  });

  /** Barcha kabinet sessiyalari (va ixtiyoriy Claude ulanishlari) bekor — masalan hisob o'g'irlangan bo'lsa. */
  app.post("/api/admin/users/:id/logout", { preHandler: requireAdmin }, async (request, reply) => {
    const user = await userById((request.params as { id: string }).id);
    if (user === null)
      return reply.code(404).send(fail("SYS_NOT_FOUND", "Foydalanuvchi topilmadi"));
    const parsed = z
      .strictObject({ claude: z.boolean().default(false) })
      .safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "claude"));
    const revoked = await revokeUserTokens(
      ctx.db,
      user.id,
      parsed.data.claude ? ["session", "access", "refresh"] : ["session"],
      ctx.now(),
    );
    await note("admin.user.logout", user.id, { revoked, claude: parsed.data.claude }, request.ip);
    return ok({ revoked });
  });
}
