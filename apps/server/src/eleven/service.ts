/**
 * ElevenLabs hisobi (P4.01): user kaliti (`secrets`, AES-256-GCM), obuna/kvota (`GET /v1/user/subscription`),
 * klient yaratish va panel indikatori (`elevenlabs.status`).
 */
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AppContext } from "../context";
import { devices } from "../db/schema";
import { RateLimiter } from "../lib/rate-limit";
import { deleteSecret, maskSecret, readSecret, saveSecret } from "../secrets";
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

const SUBSCRIPTION_TTL_MS = 60_000;
/** User bo'yicha ElevenLabs chaqiruvlari chegarasi (§4.4). */
const CALLS_PER_MINUTE = 60;

export class ElevenService {
  private readonly cache = new Map<string, { at: number; value: Subscription }>();
  private readonly limiter: RateLimiter;

  constructor(
    private readonly ctx: Pick<AppContext, "db" | "env" | "now" | "hub">,
    private readonly log: FastifyBaseLogger,
    private readonly options: ElevenOptions = {},
  ) {
    this.limiter = new RateLimiter(CALLS_PER_MINUTE, 60_000, () => ctx.now().getTime());
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

  /** User'ning klienti; kalit yo'q bo'lsa EL_AUTH. User bo'yicha rate limit. */
  async client(userId: string): Promise<Result<ElevenClient>> {
    const key = await readSecret(this.ctx, userId, "elevenlabs");
    if (key === null) {
      return fail("EL_AUTH", "ElevenLabs kaliti kiritilmagan: kabinet → Sozlamalar → ElevenLabs");
    }
    if (!this.limiter.take(userId)) {
      return fail("EL_RATE_LIMIT", `Daqiqasiga ${CALLS_PER_MINUTE} ta ElevenLabs chaqiruvi`);
    }
    return ok(this.build(key));
  }

  async subscription(userId: string, fresh = false): Promise<Result<Subscription>> {
    const cached = this.cache.get(userId);
    const nowMs = this.ctx.now().getTime();
    if (!fresh && cached !== undefined && nowMs - cached.at < SUBSCRIPTION_TTL_MS) {
      return ok(cached.value);
    }
    const key = await readSecret(this.ctx, userId, "elevenlabs");
    if (key === null) return fail("EL_AUTH", "ElevenLabs kaliti kiritilmagan");
    try {
      const value = await this.build(key).json<Subscription>("GET", "/v1/user/subscription", {
        timeoutMs: 15_000,
      });
      this.cache.set(userId, { at: nowMs, value });
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
      this.cache.set(userId, { at: this.ctx.now().getTime(), value });
    } catch (error) {
      if (error instanceof ElevenError) return { ok: false, error: error.error };
      throw error;
    }
    void this.push(userId);
    return ok(await this.account(userId));
  }

  async removeKey(userId: string): Promise<void> {
    await deleteSecret(this.ctx, userId, "elevenlabs");
    this.cache.delete(userId);
    void this.push(userId);
  }

  /** Kabinet va env_check uchun holat (kalit ochiq ko'rinmaydi). */
  async account(userId: string): Promise<ElevenAccount> {
    const key = await readSecret(this.ctx, userId, "elevenlabs");
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
