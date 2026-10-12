/**
 * Balans, sarf va Pro sozlamalari: kabinet (`/api/me/*`, sessiya) va panel (`/api/agent/*`, qurilma tokeni).
 * Admin to'ldirishi — `/admin` → Foydalanuvchilar (P9.03).
 */
import { fail, microsToUsd, ok, quoteAudio } from "@aes/shared";
import type { PricingRates } from "@aes/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";
import { users } from "../db/schema";
import type { UserPrefs } from "../db/schema";
import { authenticateDevice } from "../devices/routes";
import { presentTariff } from "./tariffs";
import type { TariffService } from "./tariffs";

const prefsSchema = z.strictObject({
  pro_music: z.boolean().optional(),
  pro_isolation: z.boolean().optional(),
});

/** Daqiqalik narxlar (Pro tugmalari yonidagi eslatma) — amaldagi stavkalar bo'yicha. */
function prices(rates: PricingRates) {
  const perMinute = (kind: "music" | "isolate", tier: "pro" | "basic") =>
    Math.round(quoteAudio(kind, {}, 60, { tier }, rates).priceUsd * 10_000) / 10_000;
  return {
    music_pro_per_min: perMinute("music", "pro"),
    music_library_per_min: perMinute("music", "basic"),
    isolation_pro_per_min: perMinute("isolate", "pro"),
    isolation_standard_per_min: perMinute("isolate", "basic"),
  };
}

export function registerBillingRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  tariffs: TariffService,
): void {
  const prefsOf = async (userId: string): Promise<UserPrefs> => {
    const [row] = await ctx.db
      .select({ prefs: users.prefs })
      .from(users)
      .where(eq(users.id, userId));
    return row?.prefs ?? {};
  };
  const setPrefs = async (userId: string, patch: UserPrefs): Promise<UserPrefs> => {
    const next = { ...(await prefsOf(userId)), ...patch };
    await ctx.db.update(users).set({ prefs: next }).where(eq(users.id, userId));
    return next;
  };
  const summary = async (userId: string) => {
    const prefs = await prefsOf(userId);
    return {
      ...(await ctx.billing.account(userId)),
      pro_music: prefs.pro_music === true,
      pro_isolation: prefs.pro_isolation === true,
      prices: prices(ctx.billing.rates),
      /** To'lov qo'lda (P9.03): kimga murojaat qilish va paketlar. */
      contact: ctx.billing.contact,
      tariffs: (await tariffs.list(true)).map(presentTariff),
    };
  };

  app.get("/api/me/billing", { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    const history = await ctx.billing.history(userId, 30);
    return ok({
      ...(await summary(userId)),
      history: history.map((row) => ({
        id: row.id,
        kind: row.kind,
        item: row.item,
        quantity: row.quantity,
        unit: row.unit,
        amount_usd: microsToUsd(row.amountMicros),
        cached: row.cached,
        job_id: row.jobId,
        note: row.note,
        created_at: row.createdAt,
      })),
    });
  });

  app.put("/api/me/preferences", { preHandler: requireUser }, async (request, reply) => {
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "pro_music / pro_isolation"));
    await setPrefs(request.user!.id, parsed.data);
    return ok(await summary(request.user!.id));
  });

  // Panel (qurilma tokeni).
  const device = async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await authenticateDevice(ctx, request.headers.authorization);
    if (identity === null) {
      await reply.code(401).send(fail("AUTH_DEVICE_REVOKED", "Qurilma tokeni yaroqsiz"));
      return null;
    }
    return identity;
  };

  app.get("/api/agent/billing", async (request, reply) => {
    const identity = await device(request, reply);
    if (identity === null) return reply;
    return ok(await summary(identity.userId));
  });

  app.put("/api/agent/preferences", async (request, reply) => {
    const identity = await device(request, reply);
    if (identity === null) return reply;
    const parsed = prefsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send(fail("SYS_BAD_REQUEST", "pro_music / pro_isolation"));
    await setPrefs(identity.userId, parsed.data);
    return ok(await summary(identity.userId));
  });
}
