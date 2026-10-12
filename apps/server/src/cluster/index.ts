/**
 * Ko'p replika (P9.07): replikalar orasida xabar (pub/sub), qisqa qulflar (lock) va hisoblagichlar.
 * - `RedisCluster` — production (Redis): kanal `aes:all` (hammaga) va `aes:r:<replica>` (bittasiga).
 * - `MemoryCluster` — bitta jarayon: sukut bo'yicha yakka (`shared = false` — barcha taqsimlangan yo'llar
 *   o'chiq, xatti-harakat avvalgidek); testlarda umumiy `MemoryNetwork` bilan bir nechta "replika".
 * Redis xatosida qulf va hisoblagich "ochiq" ishlaydi (xizmat to'xtamasin), xato logga yoziladi.
 */
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { createRedis } from "../redis";

/** Replikalararo xabar: `t` — turi, `from` — yuborgan replika (avtomatik qo'shiladi). */
export interface ClusterMessage {
  t: string;
  from?: string;
  [key: string]: unknown;
}

export type ClusterHandler = (message: ClusterMessage) => void;

export interface Cluster {
  readonly replicaId: string;
  /** Boshqa replikalar bo'lishi mumkin (taqsimlangan yo'llar yoqiladi). */
  readonly shared: boolean;
  start(): Promise<void>;
  close(): Promise<void>;
  /** Hammaga (o'ziga emas). */
  broadcast(message: ClusterMessage): void;
  /** Bitta replikaga (o'ziga ham bo'lishi mumkin). */
  sendTo(replicaId: string, message: ClusterMessage): void;
  onMessage(handler: ClusterHandler): () => void;
  /** Qulf: bo'sh bo'lsa yoki allaqachon shu replikaniki bo'lsa — true (muddat yangilanadi). */
  acquire(key: string, ttlMs: number): Promise<boolean>;
  /** Faqat egasi bo'lsa muddatni uzaytiradi. */
  renew(key: string, ttlMs: number): Promise<boolean>;
  /** Faqat egasi bo'lsa bo'shatadi. */
  release(key: string): Promise<void>;
  /** Qulf egasi (replika id) yoki null. */
  owner(key: string): Promise<string | null>;
  /** Belgilangan oynadagi hisob (rate limit): shu chaqiruv bilan nechta va oyna tugashiga qancha qoldi. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

class Handlers {
  private readonly set = new Set<ClusterHandler>();
  add(handler: ClusterHandler): () => void {
    this.set.add(handler);
    return () => this.set.delete(handler);
  }
  emit(message: ClusterMessage, log?: FastifyBaseLogger): void {
    for (const handler of this.set) {
      try {
        handler(message);
      } catch (error) {
        log?.warn({ err: error, type: message.t }, "cluster xabari qayta ishlanmadi");
      }
    }
  }
}

// ---------------------------------------------------------------- xotira (yakka va testlar)

/** Bir jarayondagi "tarmoq": testlarda bir nechta ilova (replika) shu orqali gaplashadi. */
export class MemoryNetwork {
  readonly members = new Map<string, MemoryCluster>();
  readonly locks = new Map<string, { owner: string; until: number }>();
  readonly counters = new Map<string, { count: number; until: number }>();
  constructor(readonly now: () => number = Date.now) {}
}

export class MemoryCluster implements Cluster {
  readonly replicaId: string;
  readonly shared: boolean;
  private readonly handlers = new Handlers();
  private readonly network: MemoryNetwork;

  constructor(options: { network?: MemoryNetwork; replicaId?: string } = {}) {
    this.shared = options.network !== undefined;
    this.network = options.network ?? new MemoryNetwork();
    this.replicaId = options.replicaId ?? randomUUID();
  }

  async start(): Promise<void> {
    this.network.members.set(this.replicaId, this);
  }

  async close(): Promise<void> {
    this.network.members.delete(this.replicaId);
  }

  /** Haqiqiy tarmoqdek: JSON orqali (seriyalanmaydigan narsa o'tmaydi) va asinxron. */
  private deliver(target: MemoryCluster, message: ClusterMessage): void {
    const copy = JSON.parse(JSON.stringify({ ...message, from: this.replicaId })) as ClusterMessage;
    setImmediate(() => target.handlers.emit(copy));
  }

  broadcast(message: ClusterMessage): void {
    for (const [id, member] of this.network.members) {
      if (id !== this.replicaId) this.deliver(member, message);
    }
  }

  sendTo(replicaId: string, message: ClusterMessage): void {
    const target = this.network.members.get(replicaId);
    if (target !== undefined) this.deliver(target, message);
  }

  onMessage(handler: ClusterHandler): () => void {
    return this.handlers.add(handler);
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const now = this.network.now();
    const lock = this.network.locks.get(key);
    if (lock !== undefined && lock.until > now && lock.owner !== this.replicaId) return false;
    this.network.locks.set(key, { owner: this.replicaId, until: now + ttlMs });
    return true;
  }

  async renew(key: string, ttlMs: number): Promise<boolean> {
    const lock = this.network.locks.get(key);
    if (lock === undefined || lock.owner !== this.replicaId) return false;
    lock.until = this.network.now() + ttlMs;
    return true;
  }

  async release(key: string): Promise<void> {
    if (this.network.locks.get(key)?.owner === this.replicaId) this.network.locks.delete(key);
  }

  async owner(key: string): Promise<string | null> {
    const lock = this.network.locks.get(key);
    return lock !== undefined && lock.until > this.network.now() ? lock.owner : null;
  }

  async hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const now = this.network.now();
    const counter = this.network.counters.get(key);
    if (counter === undefined || counter.until <= now) {
      this.network.counters.set(key, { count: 1, until: now + windowMs });
      if (this.network.counters.size > 10_000) {
        for (const [k, v] of this.network.counters)
          if (v.until <= now) this.network.counters.delete(k);
      }
      return { count: 1, resetMs: windowMs };
    }
    counter.count += 1;
    return { count: counter.count, resetMs: counter.until - now };
  }
}

// ---------------------------------------------------------------- Redis (production)

const RELEASE_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
const RENEW_LUA = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const ALL = "aes:all";

export class RedisCluster implements Cluster {
  readonly shared = true;
  readonly replicaId = randomUUID();
  private readonly handlers = new Handlers();
  private readonly cmd: Redis;
  private readonly sub: Redis;

  constructor(
    url: string,
    private readonly log: FastifyBaseLogger,
    /** Testlar: tayyor klientlar (masalan ioredis-mock). */
    clients?: { cmd: Redis; sub: Redis },
  ) {
    this.cmd = clients?.cmd ?? createRedis(url);
    // Obuna rejimidagi ulanish boshqa buyruq bajara olmaydi — alohida.
    this.sub = clients?.sub ?? createRedis(url);
    for (const client of [this.cmd, this.sub]) {
      client.on("error", (error: unknown) =>
        this.log.warn({ err: error }, "redis (cluster) xatosi"),
      );
    }
  }

  private channel(replicaId: string): string {
    return `aes:r:${replicaId}`;
  }

  async start(): Promise<void> {
    this.sub.on("message", (_channel: string, raw: string) => {
      let message: ClusterMessage;
      try {
        message = JSON.parse(raw) as ClusterMessage;
      } catch {
        return;
      }
      if (message.from === this.replicaId && _channel === ALL) return;
      this.handlers.emit(message, this.log);
    });
    await this.sub.subscribe(ALL, this.channel(this.replicaId));
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.sub.quit(), this.cmd.quit()]);
  }

  private publish(channel: string, message: ClusterMessage): void {
    this.cmd
      .publish(channel, JSON.stringify({ ...message, from: this.replicaId }))
      .catch((error: unknown) => this.log.warn({ err: error }, "cluster xabari yuborilmadi"));
  }

  broadcast(message: ClusterMessage): void {
    this.publish(ALL, message);
  }

  sendTo(replicaId: string, message: ClusterMessage): void {
    this.publish(this.channel(replicaId), message);
  }

  onMessage(handler: ClusterHandler): () => void {
    return this.handlers.add(handler);
  }

  private key(name: string): string {
    return `aes:lock:${name}`;
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    try {
      const set = await this.cmd.set(this.key(key), this.replicaId, "PX", ttlMs, "NX");
      if (set === "OK") return true;
      return (await this.renew(key, ttlMs)) === true;
    } catch (error) {
      this.log.error({ err: error, key }, "qulf olinmadi (Redis): ochiq rejimda davom etiladi");
      return true;
    }
  }

  async renew(key: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.cmd.eval(RENEW_LUA, 1, this.key(key), this.replicaId, ttlMs);
      return Number(result) === 1;
    } catch (error) {
      this.log.warn({ err: error, key }, "qulf uzaytirilmadi (Redis)");
      return true;
    }
  }

  async release(key: string): Promise<void> {
    try {
      await this.cmd.eval(RELEASE_LUA, 1, this.key(key), this.replicaId);
    } catch (error) {
      this.log.warn({ err: error, key }, "qulf bo'shatilmadi (Redis): muddati o'tib bo'shaydi");
    }
  }

  async owner(key: string): Promise<string | null> {
    try {
      return await this.cmd.get(this.key(key));
    } catch {
      return null;
    }
  }

  async hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }> {
    const name = `aes:rl:${key}`;
    try {
      const results = await this.cmd.multi().incr(name).pttl(name).exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      let ttl = Number(results?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await this.cmd.pexpire(name, windowMs);
        ttl = windowMs;
      }
      return { count, resetMs: ttl };
    } catch (error) {
      this.log.warn({ err: error }, "rate limit hisoblanmadi (Redis): ruxsat beriladi");
      return { count: 0, resetMs: 0 };
    }
  }
}

/**
 * Qulf ostida ish: olinmasa `null` (boshqa replika bajaryapti). Uzoq ishlar uchun muddat davriy uzaytiriladi.
 * Yakka rejimda (`shared = false`) qulfsiz bajariladi.
 */
export async function withLock<T>(
  cluster: Cluster,
  key: string,
  ttlMs: number,
  work: () => Promise<T>,
): Promise<{ done: true; value: T } | { done: false }> {
  if (!cluster.shared) return { done: true, value: await work() };
  if (!(await cluster.acquire(key, ttlMs))) return { done: false };
  const timer = setInterval(() => void cluster.renew(key, ttlMs), Math.max(1000, ttlMs / 3));
  timer.unref();
  try {
    return { done: true, value: await work() };
  } finally {
    clearInterval(timer);
    await cluster.release(key);
  }
}
