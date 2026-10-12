/** Balans va sarf (kabinet): `GET /api/me/billing`. Admin to'ldirishi — Faza 9 (`/admin`). */
import { microsToUsd, ok } from "@aes/shared";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/session";
import type { AppContext } from "../context";

export function registerBillingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/me/billing", { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    const account = await ctx.billing.account(userId);
    const history = await ctx.billing.history(userId, 30);
    return ok({
      ...account,
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
}
