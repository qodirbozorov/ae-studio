/**
 * Claude indikatori (§11.1, P3.08): user'da faol OAuth tokeni bormi (ulangan) va oxirgi MCP chaqiruvi qachon.
 * Har MCP so'rovida (30 s da ko'pi bilan bir marta) va panel `hello` da user'ning onlayn panellariga `claude.status`.
 */
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { devices, oauthTokens } from "../db/schema";

const PUSH_INTERVAL_MS = 30_000;

export class ClaudePresence {
  private readonly lastSeen = new Map<string, Date>();
  private readonly lastPushed = new Map<string, number>();

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "hub" | "now"> &
      Partial<Pick<AppContext, "cluster">>,
    private readonly log: FastifyBaseLogger,
  ) {}

  attach(): void {
    this.ctx.hub.onMessage((identity, message) => {
      if (message.type === "hello") void this.pushTo(identity.userId, [identity.deviceId]);
    });
    // Ko'p replika (P9.07): MCP so'rovi boshqa replikaga tushsa ham "oxirgi faollik" hammada bir xil.
    this.ctx.cluster?.onMessage((message) => {
      if (message.t !== "claude.seen" || typeof message.u !== "string") return;
      const at = new Date(String(message.at));
      const known = this.lastSeen.get(message.u);
      if (!Number.isNaN(at.getTime()) && (known === undefined || known < at)) {
        this.lastSeen.set(message.u, at);
      }
    });
  }

  /** MCP so'rovi keldi. */
  touch(userId: string): void {
    const now = this.ctx.now();
    this.lastSeen.set(userId, now);
    const pushed = this.lastPushed.get(userId) ?? 0;
    if (now.getTime() - pushed < PUSH_INTERVAL_MS) return;
    this.lastPushed.set(userId, now.getTime());
    if (this.ctx.cluster?.shared === true) {
      this.ctx.cluster.broadcast({ t: "claude.seen", u: userId, at: now.toISOString() });
    }
    void this.pushTo(userId);
  }

  async status(userId: string): Promise<{ linked: boolean; last_seen_at: string | null }> {
    const now = this.ctx.now();
    const [token] = await this.ctx.db
      .select({ id: oauthTokens.id })
      .from(oauthTokens)
      .where(
        and(
          eq(oauthTokens.userId, userId),
          inArray(oauthTokens.kind, ["access", "refresh"]),
          isNull(oauthTokens.revokedAt),
          or(isNull(oauthTokens.expiresAt), gt(oauthTokens.expiresAt, now)),
        ),
      )
      .limit(1);
    return {
      linked: token !== undefined,
      last_seen_at: this.lastSeen.get(userId)?.toISOString() ?? null,
    };
  }

  /** User'ning onlayn panellariga (yoki berilganlariga) holatni yuboradi. */
  async pushTo(userId: string, deviceIds?: string[]): Promise<void> {
    try {
      const targets =
        deviceIds ??
        (
          await this.ctx.db
            .select({ id: devices.id })
            .from(devices)
            .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        ).map((row) => row.id);
      const online = targets.filter((id) => this.ctx.hub.isOnline(id));
      if (online.length === 0) return;
      const status = await this.status(userId);
      for (const id of online) this.ctx.hub.send(id, { type: "claude.status", ...status });
    } catch (error) {
      this.log.warn({ err: error }, "claude.status yuborilmadi");
    }
  }
}
