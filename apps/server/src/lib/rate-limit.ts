/**
 * Rate limit. `RateLimiter` — xotirada sirpanuvchi oyna (bitta jarayon). `createLimiter` — umumiy interfeys:
 * yakka rejimda shu `RateLimiter`, ko'p replikada (P9.07) — cluster (Redis) hisoblagichi, belgilangan oyna.
 * Kalit: user yoki IP.
 */
import type { Cluster } from "../cluster";

export interface Limiter {
  check(key: string): Promise<{ allowed: boolean; retryAfterS: number }>;
}

export function createLimiter(
  cluster: Cluster | undefined,
  name: string,
  limit: number,
  windowMs: number,
  now: () => number = Date.now,
): Limiter {
  if (cluster === undefined || !cluster.shared) {
    const local = new RateLimiter(limit, windowMs, now);
    return {
      async check(key) {
        const allowed = local.take(key);
        return { allowed, retryAfterS: allowed ? 0 : local.retryAfterS(key) };
      },
    };
  }
  return {
    async check(key) {
      const { count, resetMs } = await cluster.hit(`${name}:${key}`, windowMs);
      const allowed = count <= limit;
      return { allowed, retryAfterS: allowed ? 0 : Math.max(1, Math.ceil(resetMs / 1000)) };
    },
  };
}

/** Xotiradagi sirpanuvchi oyna. `take()` ruxsat bo'lsa `true`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): boolean {
    const nowMs = this.now();
    const since = nowMs - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(nowMs);
    this.hits.set(key, list);
    if (this.hits.size > 10_000) this.sweep(since);
    return true;
  }

  /** Keyingi ruxsatgacha qolgan vaqt (soniya). */
  retryAfterS(key: string): number {
    const list = this.hits.get(key) ?? [];
    const oldest = list[0];
    if (oldest === undefined) return 0;
    return Math.max(1, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }

  private sweep(since: number): void {
    for (const [key, list] of this.hits) {
      if (list.every((t) => t <= since)) this.hits.delete(key);
    }
  }
}
