import { Redis } from "ioredis";

/** Server Redis'dan foydalanadigan minimal interfeys (testlarda soxtasi beriladi). */
export interface RedisLike {
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export function createRedis(url: string): Redis {
  return new Redis(url, {
    // Railway private tarmog'i IPv6: 0 = IPv4 va IPv6 ikkalasi.
    family: 0,
    connectTimeout: 10_000,
    maxRetriesPerRequest: 3,
  });
}
