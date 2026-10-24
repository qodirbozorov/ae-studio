/**
 * ElevenLabs hisobi (P4.01): markaziy kalit (admin panel → `system_settings.elevenlabs`, AES-256-GCM;
 * bo'lmasa env), eski user kaliti (`secrets`), obuna/kvota (`GET /v1/user/subscription`), klient yaratish
 * va panel indikatori (`elevenlabs.status`).
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { devices, systemSettings, usageLedger } from "../db/schema";
import { createLimiter } from "../lib/rate-limit";
import type { Limiter } from "../lib/rate-limit";
import {
  deleteSecret,
  maskSecret,
  openSecret,
  readSecret,
  saveSecret,
  sealSecret,
} from "../secrets";
import { ElevenClient, ElevenError } from "./client";
import type { ElevenOptions } from "./client";

export interface Subscription {
  tier: string;
  status: string;
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix?: number | null;
  can_use_instant_voice_cloning?: boolean;
  voice_limit?: number;
  voice_slots_used?: number;
  billing_period?: string;
}

export interface ElevenAccount {
  configured: boolean;
  masked: string | null;
  tier: string | null;
  status: string | null;
  character_count: number | null;
  character_limit: number | null;
  remaining: number | null;
  next_reset: string | null;
  can_clone: boolean | null;
  error: string | null;
}

export const ELEVEN_SETTINGS_KEY = "elevenlabs";

export type ElevenKeySource = "db" | "env" | "none";

/** Admin → Audio: markaziy kalit holati, kvota va sarf (kalit ochiq ko'rinmaydi). */
export interface ElevenAdminView {
  source: ElevenKeySource;
  masked: string | null;
  /** Env'da ham kalit bormi (DB'dagisi o'chirilsa shunga qaytadi). */
  env_key: boolean;
  updated_at: string | null;
  updated_by: string | null;
  account: {
    tier: string;
    status: string;
    character_count: number;
    character_limit: number;
    remaining: number;
    next_reset: string | null;
    voice_limit: number | null;
    voice_slots_used: number | null;
    can_clone: boolean | null;
    billing_period: string | null;
  } | null;
  error: { code: string; message: string | null } | null;
  usage: {
    since: string;
    items: {
      item: string;
      unit: string;
      count: number;
      quantity: number;
      cached: number;
      cost_usd: number;
      charged_usd: number;
    }[];
    total_cost_usd: number;
    total_charged_usd: number;
  };
}

interface SystemKey {
  key: string | null;
  source: ElevenKeySource;
  updatedAt: Date | null;
  updatedBy: string | null;
}

const SUBSCRIPTION_TTL_MS = 60_000;
/** Markaziy kalit keshi: boshqa replika/worker admin o'zgarishini shuncha vaqtda ko'radi. */
const SYSTEM_TTL_MS = 30_000;
/** User bo'yicha ElevenLabs chaqiruvlari chegarasi (§4.4). */
const CALLS_PER_MINUTE = 60;

export class ElevenService {
  /** Obuna keshi kalit bo'yicha (markaziy kalit hamma uchun bitta). */
  private readonly cache = new Map<string, { at: number; value: Subscription }>();
  private system: (SystemKey & { at: number }) | null = null;
  private readonly limiter: Limiter;

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "env" | "now" | "hub"> &
      Partial<Pick<AppContext, "cluster">>,
    private readonly log: FastifyBaseLogger,
    private readonly options: ElevenOptions = {},
  ) {
    this.limiter = createLimiter(ctx.cluster, "audio", CALLS_PER_MINUTE, 60_000, () =>
      ctx.now().getTime(),
    );
  }

  attach(): void {
    this.ctx.hub.onMessage((identity, message) => {
      if (message.type === "hello") void this.push(identity.userId, [identity.deviceId]);
    });
  }

  private build(key: string): ElevenClient {
    return new ElevenClient(key, {
      ...this.options,
      ...(this.ctx.env.ELEVENLABS_BASE_URL === undefined
        ? {}
        : { baseUrl: this.ctx.env.ELEVENLABS_BASE_URL }),
    });
  }

  private envKey(): string | null {
    return this.ctx.env.ELEVENLABS_API_KEY ?? this.ctx.env.ELEVENLABS_DEFAULT_KEY ?? null;
  }

  /** Markaziy kalit: admin panelda saqlangani (DB), bo'lmasa env. */
  private async systemKey(): Promise<SystemKey> {
    const nowMs = this.ctx.now().getTime();
    if (this.system !== null && nowMs - this.system.at < SYSTEM_TTL_MS) return this.system;
    const [row] = await this.ctx.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, ELEVEN_SETTINGS_KEY));
    let key: string | null = null;
    if (row?.secret != null) {
      try {
        key = openSecret(this.ctx.env, row.secret);
      } catch (error) {
        this.log.error(
          { err: error },
          "ElevenLabs kalitini ochib bo'lmadi (MASTER_KEY?): env ishlatiladi",
        );
      }
    }
    const value: SystemKey =
      key !== null
        ? { key, source: "db", updatedAt: row!.updatedAt, updatedBy: row!.updatedBy }
        : {
            key: this.envKey(),
            source: this.envKey() === null ? "none" : "env",
            updatedAt: row?.updatedAt ?? null,
            updatedBy: row?.updatedBy ?? null,
          };
    this.system = { ...value, at: nowMs };
    return value;
  }

  /** Admin o'zgartirdi (shu yoki boshqa replikada): keshlar tozalanadi. */
  invalidate(): void {
    this.system = null;
    this.cache.clear();
  }

  /**
   * Kalit: markaziy (admin panel yoki env) — bo'lmasa foydalanuvchi kabinetda kiritgan eski kalit
   * (o'tish davri).
   */
  private async keyFor(userId: string): Promise<string | null> {
    return (await this.systemKey()).key ?? (await readSecret(this.ctx, userId, "elevenlabs"));
  }

  /** User'ning klienti; kalit yo'q bo'lsa EL_AUTH. User bo'yicha rate limit. */
  async client(userId: string): Promise<Result<ElevenClient>> {
    const key = await this.keyFor(userId);
    if (key === null) {
      return fail("EL_AUTH", "Audio xizmati sozlanmagan (administrator: admin panel → Audio)");
    }
    if (!(await this.limiter.check(userId)).allowed) {
      return fail("EL_RATE_LIMIT", `Daqiqasiga ${CALLS_PER_MINUTE} ta audio so'rov`);
    }
    return ok(this.build(key));
  }

  async subscription(userId: string, fresh = false): Promise<Result<Subscription>> {
    const key = await this.keyFor(userId);
    if (key === null) return fail("EL_AUTH", "Audio xizmati sozlanmagan");
    return this.subscriptionOf(key, fresh);
  }

  private async subscriptionOf(key: string, fresh = false): Promise<Result<Subscription>> {
    const cached = this.cache.get(key);
    const nowMs = this.ctx.now().getTime();
    if (!fresh && cached !== undefined && nowMs - cached.at < SUBSCRIPTION_TTL_MS) {
      return ok(cached.value);
    }
    try {
      const value = await this.build(key).json<Subscription>("GET", "/v1/user/subscription", {
        timeoutMs: 15_000,
      });
      this.cache.set(key, { at: nowMs, value });
      return ok(value);
    } catch (error) {
      if (error instanceof ElevenError) return { ok: false, error: error.error };
      throw error;
    }
  }

  /** Kalitni tekshirib saqlaydi (noto'g'ri kalit saqlanmaydi). */
  async setKey(userId: string, apiKey: string): Promise<Result<ElevenAccount>> {
    const key = apiKey.trim();
    try {
      const value = await this.build(key).json<Subscription>("GET", "/v1/user/subscription", {
        timeoutMs: 15_000,
      });
      await saveSecret(this.ctx, userId, "elevenlabs", key);
      this.cache.set(key, { at: this.ctx.now().getTime(), value });
    } catch (error) {
      if (error instanceof ElevenError) return { ok: false, error: error.error };
      throw error;
    }
    void this.push(userId);
    return ok(await this.account(userId));
  }

  async removeKey(userId: string): Promise<void> {
    await deleteSecret(this.ctx, userId, "elevenlabs");
    void this.push(userId);
  }

  /** Kabinet, env_check va CHECK uchun holat — markaziy kalit ham hisobga olinadi (ochiq ko'rinmaydi). */
  async account(userId: string): Promise<ElevenAccount> {
    const key = await this.keyFor(userId);
    const empty: ElevenAccount = {
      configured: false,
      masked: null,
      tier: null,
      status: null,
      character_count: null,
      character_limit: null,
      remaining: null,
      next_reset: null,
      can_clone: null,
      error: null,
    };
    if (key === null) return empty;
    const sub = await this.subscription(userId);
    if (!sub.ok) {
      return { ...empty, configured: true, masked: maskSecret(key), error: sub.error.code };
    }
    const s = sub.data;
    return {
      configured: true,
      masked: maskSecret(key),
      tier: s.tier,
      status: s.status,
      character_count: s.character_count,
      character_limit: s.character_limit,
      remaining: Math.max(0, s.character_limit - s.character_count),
      next_reset:
        typeof s.next_character_count_reset_unix === "number"
          ? new Date(s.next_character_count_reset_unix * 1000).toISOString()
          : null,
      can_clone: s.can_use_instant_voice_cloning ?? null,
      error: null,
    };
  }

  private async writeSystem(
    key: string | null,
    value: Record<string, unknown>,
    by: string,
  ): Promise<void> {
    const sealed = key === null ? null : sealSecret(this.ctx.env, key);
    await this.ctx.db
      .insert(systemSettings)
      .values({
        key: ELEVEN_SETTINGS_KEY,
        value,
        secret: sealed,
        updatedBy: by,
        updatedAt: this.ctx.now(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, secret: sealed, updatedBy: by, updatedAt: this.ctx.now() },
      });
    this.invalidate();
    void this.pushAll();
  }

  /** Admin: kalitni tekshirib (obuna so'rovi) shifrlab saqlaydi; noto'g'ri kalit saqlanmaydi. */
  async setSystemKey(apiKey: string, by: string): Promise<Result<ElevenAdminView>> {
    if (this.ctx.env.MASTER_KEY === undefined) {
      return fail("SYS_BAD_REQUEST", "MASTER_KEY sozlanmagan: kalitni shifrlab saqlab bo'lmaydi");
    }
    const key = apiKey.trim();
    const checked = await this.subscriptionOf(key, true);
    if (!checked.ok) return checked;
    await this.writeSystem(key, { masked: maskSecret(key) }, by);
    return ok(await this.adminView());
  }

  /** Admin: DB'dagi kalitni o'chiradi — env'da kalit bo'lsa shunga qaytadi. */
  async removeSystemKey(by: string): Promise<ElevenAdminView> {
    await this.writeSystem(null, { removed: true }, by);
    return this.adminView();
  }

  /**
   * Ishga tushganda: DB'da yozuv yo'q, env'da kalit bor — shifrlab DB'ga ko'chiradi (bir marta;
   * admin o'chirgan bo'lsa yozuv qoladi va qayta ko'chirilmaydi). Replikalar poygasi: `do nothing`.
   */
  async seedFromEnv(): Promise<boolean> {
    const key = this.envKey();
    if (key === null || this.ctx.env.MASTER_KEY === undefined) return false;
    const inserted = await this.ctx.db
      .insert(systemSettings)
      .values({
        key: ELEVEN_SETTINGS_KEY,
        value: { masked: maskSecret(key), seeded_from_env: true },
        secret: sealSecret(this.ctx.env, key),
        updatedBy: "env",
        updatedAt: this.ctx.now(),
      })
      .onConflictDoNothing()
      .returning({ key: systemSettings.key });
    if (inserted.length > 0) this.invalidate();
    return inserted.length > 0;
  }

  /** Joriy kvota davri boshi: keyingi yangilanishdan bir oy oldin (noma'lum bo'lsa 30 kun). */
  private periodStart(nextReset: string | null): Date {
    if (nextReset !== null) {
      const start = new Date(nextReset);
      start.setUTCMonth(start.getUTCMonth() - 1);
      if (start.getTime() <= this.ctx.now().getTime()) return start;
    }
    return new Date(this.ctx.now().getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  async adminView(fresh = false): Promise<ElevenAdminView> {
    const system = await this.systemKey();
    let account: ElevenAdminView["account"] = null;
    let error: ElevenAdminView["error"] = null;
    if (system.key !== null) {
      const sub = await this.subscriptionOf(system.key, fresh);
      if (sub.ok) {
        const s = sub.data;
        account = {
          tier: s.tier,
          status: s.status,
          character_count: s.character_count,
          character_limit: s.character_limit,
          remaining: Math.max(0, s.character_limit - s.character_count),
          next_reset:
            typeof s.next_character_count_reset_unix === "number"
              ? new Date(s.next_character_count_reset_unix * 1000).toISOString()
              : null,
          voice_limit: s.voice_limit ?? null,
          voice_slots_used: s.voice_slots_used ?? null,
          can_clone: s.can_use_instant_voice_cloning ?? null,
          billing_period: s.billing_period ?? null,
        };
      } else {
        error = { code: sub.error.code, message: sub.error.message ?? null };
      }
    }
    const since = this.periodStart(account?.next_reset ?? null);
    // Audio sarfi (vaqt chizig'i to'lovi va to'ldirishlar emas) — joriy kvota davri bo'yicha.
    const rows = await this.ctx.db
      .select({
        item: usageLedger.item,
        unit: usageLedger.unit,
        count: sql<number>`count(*)::int`,
        quantity: sql<number>`coalesce(sum(${usageLedger.quantity}), 0)::float8`,
        cached: sql<number>`count(*) filter (where ${usageLedger.cached})::int`,
        cost: sql<number>`coalesce(sum(${usageLedger.costMicros}), 0)::float8`,
        amount: sql<number>`coalesce(sum(${usageLedger.amountMicros}), 0)::float8`,
      })
      .from(usageLedger)
      .where(
        and(
          eq(usageLedger.kind, "charge"),
          ne(usageLedger.item, "timeline"),
          gte(usageLedger.createdAt, since),
        ),
      )
      .groupBy(usageLedger.item, usageLedger.unit);
    const usd = (micros: number) => Math.round(micros / 10_000) / 100;
    const items = rows
      .map((row) => ({
        item: row.item,
        unit: row.unit,
        count: Number(row.count),
        quantity: Math.round(Number(row.quantity) * 100) / 100,
        cached: Number(row.cached),
        cost_usd: usd(Number(row.cost)),
        charged_usd: usd(Number(row.amount)),
      }))
      .sort((a, b) => b.cost_usd - a.cost_usd || b.count - a.count);
    return {
      source: system.source,
      masked: system.key === null ? null : maskSecret(system.key),
      env_key: this.envKey() !== null,
      updated_at: system.updatedAt?.toISOString() ?? null,
      updated_by: system.updatedBy,
      account,
      error,
      usage: {
        since: since.toISOString(),
        items,
        total_cost_usd: usd(rows.reduce((sum, row) => sum + Number(row.cost), 0)),
        total_charged_usd: usd(rows.reduce((sum, row) => sum + Number(row.amount), 0)),
      },
    };
  }

  /** Markaziy kalit o'zgardi: barcha ulangan panellarga yangi holat. */
  private async pushAll(): Promise<void> {
    try {
      const rows = await this.ctx.db
        .select({ id: devices.id, userId: devices.userId })
        .from(devices)
        .where(isNull(devices.revokedAt));
      const byUser = new Map<string, string[]>();
      for (const row of rows) {
        if (!this.ctx.hub.isOnline(row.id)) continue;
        byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.id]);
      }
      for (const [userId, ids] of byUser) await this.push(userId, ids);
    } catch (error) {
      this.log.warn({ err: error }, "elevenlabs.status tarqatilmadi");
    }
  }

  /** Panel indikatori. */
  async push(userId: string, deviceIds?: string[]): Promise<void> {
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
      const account = await this.account(userId);
      for (const id of online) {
        this.ctx.hub.send(id, {
          type: "elevenlabs.status",
          configured: account.configured,
          ok: account.configured && account.error === null,
          remaining: account.remaining,
        });
      }
    } catch (error) {
      this.log.warn({ err: error }, "elevenlabs.status yuborilmadi");
    }
  }
}
