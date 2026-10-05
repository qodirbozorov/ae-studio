/**
 * Oddiy sirpanuvchi oyna rate limiter (xotirada; bitta server nusxasi uchun yetarli).
 * Kalit: user yoki IP. `take()` ruxsat bo'lsa `true`.
 */
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
