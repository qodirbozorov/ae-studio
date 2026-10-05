/**
 * Audit jurnali (P3.10): xavfsizlikka oid hodisalar `audit_log` ga. Yozish xatosi asosiy amalni to'xtatmaydi.
 */
import { ok } from "@aes/shared";
import { desc, eq } from "drizzle-orm";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { requireUser } from "./auth/session";
import type { AppContext } from "./context";
import { auditLog } from "./db/schema";

export type AuditActor = "user" | "claude" | "device" | "system";

export interface AuditEntry {
  userId: string | null;
  actor: AuditActor;
  action: string;
  target?: string | null;
  ip?: string | null;
  data?: unknown;
}

export async function audit(
  ctx: Pick<AppContext, "db" | "now">,
  log: FastifyBaseLogger,
  entry: AuditEntry,
): Promise<void> {
  try {
    await ctx.db.insert(auditLog).values({
      userId: entry.userId,
      ts: ctx.now(),
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      ip: entry.ip ?? null,
      data: entry.data ?? null,
    });
  } catch (error) {
    log.warn({ err: error, action: entry.action }, "audit yozilmadi");
  }
}

/** Kabinet: o'z hodisalari (oxirgi 100 ta). */
export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/audit", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.userId, request.user!.id))
      .orderBy(desc(auditLog.id))
      .limit(100);
    return ok(
      rows.map((row) => ({
        ts: row.ts,
        actor: row.actor,
        action: row.action,
        target: row.target,
        ip: row.ip,
        data: row.data,
      })),
    );
  });
}
