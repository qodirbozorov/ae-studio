/**
 * Admin → Narxlar va tariflar (P9.03–P9.04): stavkalar (kod + farqlar), to'lov kontakti, tarif paketlari va
 * umumiy ko'rsatkichlar. Har o'zgarish audit'da (oldingi va yangi qiymat bilan).
 */
import { DEFAULT_RATES, fail, microsToUsd, ok } from "@aes/shared";
import { count, gt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit";
import { billingSettingsSchema } from "../billing/settings";
import { presentTariff, tariffInputSchema, tariffPatchSchema } from "../billing/tariffs";
import type { TariffService } from "../billing/tariffs";
import type { AppContext } from "../context";
import { usageLedger, users } from "../db/schema";
import { makeRequireAdmin } from "./auth";

export function registerAdminBillingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  tariffService: TariffService,
): void {
  const requireAdmin = makeRequireAdmin(ctx);
  const note = (action: string, data: unknown, ip: string) =>
    audit(ctx, app.log, { userId: null, actor: "admin", action, ip, data });

  const pricingView = () => ({
    defaults: DEFAULT_RATES,
    rates: ctx.billing.rates,
    overrides: ctx.billing.stored.rates ?? {},
    contact: ctx.billing.contact,
    enforced: ctx.billing.enforced,
  });

  app.get("/api/admin/pricing", { preHandler: requireAdmin }, async () => ok(pricingView()));

  /** To'liq almashtirish: yuborilmagan stavka — kod qiymatiga qaytadi. */
  app.put("/api/admin/pricing", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = billingSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply
        .code(400)
        .send(fail("SYS_BAD_REQUEST", `${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""}`));
    }
    const before = ctx.billing.stored;
    await ctx.billing.saveSettings(parsed.data, `admin:${ctx.env.ADMIN_LOGIN ?? "?"}`);
    ctx.cluster.broadcast({ t: "settings", key: "billing" });
    await note("admin.pricing.update", { before, after: parsed.data }, request.ip);
    return ok(pricingView());
  });

  app.get("/api/admin/tariffs", { preHandler: requireAdmin }, async () =>
    ok({ tariffs: (await tariffService.list()).map(presentTariff) }),
  );

  app.post("/api/admin/tariffs", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = tariffInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", parsed.error.issues[0]?.message ?? ""));
    }
    const row = await tariffService.create(parsed.data);
    await note("admin.tariff.create", presentTariff(row), request.ip);
    return ok(presentTariff(row));
  });

  app.patch("/api/admin/tariffs/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const parsed = tariffPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(fail("SYS_BAD_REQUEST", parsed.error.issues[0]?.message ?? ""));
    }
    const row = await tariffService.update(id, parsed.data);
    if (row === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Tarif topilmadi"));
    await note("admin.tariff.update", { id, ...parsed.data }, request.ip);
    return ok(presentTariff(row));
  });

  app.delete("/api/admin/tariffs/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!z.uuid().safeParse(id).success) return reply.code(404).send(fail("SYS_NOT_FOUND"));
    const row = await tariffService.remove(id);
    if (row === null) return reply.code(404).send(fail("SYS_NOT_FOUND", "Tarif topilmadi"));
    await note("admin.tariff.delete", presentTariff(row), request.ip);
    return ok({ removed: true });
  });

  /** Umumiy ko'rsatkichlar: foydalanuvchilar, tushum (to'ldirish), sarf va tannarx (jami va 30 kun). */
  app.get("/api/admin/overview", { preHandler: requireAdmin }, async () => {
    const since = new Date(ctx.now().getTime() - 30 * 24 * 3600_000);
    const sums = async (from?: Date) =>
      ctx.db
        .select({
          kind: usageLedger.kind,
          amount: sql<string>`coalesce(sum(${usageLedger.amountMicros}), 0)`,
          cost: sql<string>`coalesce(sum(${usageLedger.costMicros}), 0)`,
        })
        .from(usageLedger)
        .where(from === undefined ? undefined : gt(usageLedger.createdAt, from))
        .groupBy(usageLedger.kind);
    const shape = (rows: Awaited<ReturnType<typeof sums>>) => {
      const pick = (kind: string, field: "amount" | "cost") =>
        microsToUsd(Number(rows.find((row) => row.kind === kind)?.[field] ?? 0));
      const spent = -pick("charge", "amount");
      const cost = pick("charge", "cost");
      return {
        topup_usd: pick("topup", "amount"),
        spent_usd: spent,
        cost_usd: cost,
        margin_usd: Math.round((spent - cost) * 100) / 100,
      };
    };
    const [all, recent, [counts]] = await Promise.all([
      sums(),
      sums(since),
      ctx.db
        .select({
          total: count(),
          activated: sql<number>`count(${users.activatedAt})::int`,
          blocked: sql<number>`count(${users.blockedAt})::int`,
          balance: sql<string>`coalesce(sum(${users.balanceMicros}), 0)`,
        })
        .from(users),
    ]);
    return ok({
      users: {
        total: counts?.total ?? 0,
        activated: counts?.activated ?? 0,
        blocked: counts?.blocked ?? 0,
        balance_usd: microsToUsd(Number(counts?.balance ?? 0)),
      },
      all_time: shape(all),
      last_30d: shape(recent),
    });
  });
}
