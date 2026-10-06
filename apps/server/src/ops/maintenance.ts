/**
 * Production xizmat ko'rsatish (P5.13):
 * - DB backup storage'ga (`system/backups/<vaqt>.ndjson.gz`), oxirgi `BACKUP_KEEP` tasi saqlanadi;
 * - loglarni saqlash muddati: yakunlangan joblarning `job_events` (`LOG_RETENTION_DAYS`), audit jurnali (1 yil),
 *   eskirgan OAuth tokenlari, Telegram bog'lash kodlari.
 * Rejalashtiruvchi faqat production'da (yoki `BACKUP_INTERVAL_H` berilsa) ishlaydi; soatiga bir tekshiradi.
 */
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { auditLog, jobEvents, jobs, oauthTokens, telegramLinks } from "../db/schema";
import { dumpDatabase } from "./backup";
import type { BackupStats } from "./backup";

export const BACKUP_PREFIX = "system/backups/";
const DAY_MS = 24 * 3600_000;
const AUDIT_RETENTION_DAYS = 365;
const TOKEN_GRACE_DAYS = 7;

export interface CleanupStats {
  job_events: number;
  audit_log: number;
  oauth_tokens: number;
  telegram_codes: number;
}

export class MaintenanceService {
  private timer: NodeJS.Timeout | null = null;
  private lastBackup = 0;
  private lastCleanup = 0;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "storage" | "env" | "now">,
    private readonly log: FastifyBaseLogger,
  ) {}

  private get keep(): number {
    return this.ctx.env.BACKUP_KEEP;
  }

  async backup(): Promise<{ key: string; bytes: number; stats: BackupStats; pruned: string[] }> {
    const { data, stats } = await dumpDatabase(this.ctx.db);
    const stamp = this.ctx.now().toISOString().replace(/[:.]/g, "-");
    const key = `${BACKUP_PREFIX}${stamp}.ndjson.gz`;
    await this.ctx.storage.putBytes(key, data, "application/gzip");
    const all = (await this.ctx.storage.list(BACKUP_PREFIX)).filter((k) =>
      k.endsWith(".ndjson.gz"),
    );
    const pruned = all.slice(0, Math.max(0, all.length - this.keep));
    for (const old of pruned) await this.ctx.storage.delete(old);
    this.log.info({ key, bytes: data.length, ...stats, pruned: pruned.length }, "DB backup");
    return { key, bytes: data.length, stats, pruned };
  }

  async cleanup(): Promise<CleanupStats> {
    const now = this.ctx.now().getTime();
    const logCutoff = new Date(now - this.ctx.env.LOG_RETENTION_DAYS * DAY_MS);
    const finished = this.ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.state, "DONE"), lt(jobs.updatedAt, logCutoff)));
    const events = await this.ctx.db
      .delete(jobEvents)
      .where(and(lt(jobEvents.ts, logCutoff), inArray(jobEvents.jobId, finished)))
      .returning({ id: jobEvents.id });
    const audits = await this.ctx.db
      .delete(auditLog)
      .where(lt(auditLog.ts, new Date(now - AUDIT_RETENTION_DAYS * DAY_MS)))
      .returning({ id: auditLog.id });
    const tokens = await this.ctx.db
      .delete(oauthTokens)
      .where(lt(oauthTokens.expiresAt, new Date(now - TOKEN_GRACE_DAYS * DAY_MS)))
      .returning({ id: oauthTokens.id });
    const codes = await this.ctx.db
      .update(telegramLinks)
      .set({ code: null, codeExpiresAt: null })
      .where(and(isNotNull(telegramLinks.code), lt(telegramLinks.codeExpiresAt, new Date(now))))
      .returning({ userId: telegramLinks.userId });
    const stats = {
      job_events: events.length,
      audit_log: audits.length,
      oauth_tokens: tokens.length,
      telegram_codes: codes.length,
    };
    this.log.info(stats, "tozalash");
    return stats;
  }

  /** Soatiga bir: muddati kelgan backup va tozalash. */
  async tick(): Promise<void> {
    if (this.running !== null) return;
    const now = this.ctx.now().getTime();
    const interval = this.ctx.env.BACKUP_INTERVAL_H * 3600_000;
    const work = (async () => {
      if (interval > 0 && now - this.lastBackup >= interval) {
        this.lastBackup = now;
        await this.backup();
      }
      if (now - this.lastCleanup >= DAY_MS) {
        this.lastCleanup = now;
        await this.cleanup();
      }
    })().catch((error: unknown) => this.log.error({ err: error }, "xizmat ko'rsatish xatosi"));
    this.running = work;
    await work;
    this.running = null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), 3600_000);
    this.timer.unref();
    // Ishga tushgandan 1 daqiqa keyin birinchi tekshiruv (deploy paytida yuklamaslik uchun).
    setTimeout(() => void this.tick(), 60_000).unref();
  }

  async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
