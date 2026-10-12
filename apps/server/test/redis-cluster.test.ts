/**
 * P9.07: `RedisCluster` buyruqlari (SET NX PX, Lua orqali uzaytirish/bo'shatish, INCR+PTTL, pub/sub)
 * ioredis-mock bilan — haqiqiy Redis'siz ham ikki "replika" orasidagi xatti-harakat tekshiriladi.
 */
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";
import { RedisCluster } from "../src/cluster";
import type { ClusterMessage } from "../src/cluster";

const log = {
  warn: () => undefined,
  error: () => undefined,
  info: () => undefined,
} as never;

let opened: RedisCluster[] = [];

/** Har chaqiruvda yangi "replika": ikki ulanish (buyruq + obuna), umumiy mock ma'lumotlar bazasi. */
async function replica(): Promise<RedisCluster> {
  const cluster = new RedisCluster("redis://mock", log, {
    cmd: new RedisMock() as unknown as Redis,
    sub: new RedisMock() as unknown as Redis,
  });
  await cluster.start();
  opened.push(cluster);
  return cluster;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

afterEach(async () => {
  await Promise.all(opened.map((c) => c.close()));
  opened = [];
  await new RedisMock().flushall();
});

describe("RedisCluster", () => {
  it("qulf: bittasi oladi, ikkinchisi yo'q; egasi uzaytiradi va bo'shatadi; begona bo'shata olmaydi", async () => {
    const a = await replica();
    const b = await replica();
    expect(await a.acquire("job:1", 5000)).toBe(true);
    expect(await b.acquire("job:1", 5000)).toBe(false);
    expect(await a.acquire("job:1", 5000)).toBe(true);
    expect(await a.owner("job:1")).toBe(a.replicaId);
    expect(await b.renew("job:1", 5000)).toBe(false);
    expect(await a.renew("job:1", 5000)).toBe(true);
    await b.release("job:1");
    expect(await a.owner("job:1")).toBe(a.replicaId);
    await a.release("job:1");
    expect(await a.owner("job:1")).toBeNull();
    expect(await b.acquire("job:1", 5000)).toBe(true);
  });

  it("hisoblagich oynada o'sadi va qolgan vaqtni beradi", async () => {
    const a = await replica();
    const b = await replica();
    expect((await a.hit("login:1.2.3.4", 60_000)).count).toBe(1);
    const second = await b.hit("login:1.2.3.4", 60_000);
    expect(second.count).toBe(2);
    expect(second.resetMs).toBeGreaterThan(0);
    expect(second.resetMs).toBeLessThanOrEqual(60_000);
  });

  it("pub/sub: broadcast boshqalarga (o'ziga emas), sendTo aniq replikaga", async () => {
    const a = await replica();
    const b = await replica();
    const c = await replica();
    const got: Record<string, ClusterMessage[]> = { a: [], b: [], c: [] };
    a.onMessage((m) => got.a!.push(m));
    b.onMessage((m) => got.b!.push(m));
    c.onMessage((m) => got.c!.push(m));
    a.broadcast({ t: "hello", n: 1 });
    a.sendTo(c.replicaId, { t: "direct", n: 2 });
    await settle();
    expect(got.a).toEqual([]);
    expect(got.b).toEqual([{ t: "hello", n: 1, from: a.replicaId }]);
    expect(got.c).toEqual(
      expect.arrayContaining([
        { t: "hello", n: 1, from: a.replicaId },
        { t: "direct", n: 2, from: a.replicaId },
      ]),
    );
  });
});
