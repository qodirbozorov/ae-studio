import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { loadEnv } from "../src/env";
import { TimeoutError, withTimeout } from "../src/lib/timeout";
import type { RedisLike } from "../src/redis";
import { SERVER_VERSION } from "../src/version";

const env = loadEnv({
  DATABASE_URL: "postgresql://test@localhost/test",
  REDIS_URL: "redis://localhost:6379",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
});

const okRedis: RedisLike = { ping: async () => "PONG", quit: async () => "OK" };

let app: FastifyInstance | undefined;
let pglite: PGlite;

beforeAll(async () => {
  pglite = await PGlite.create();
});

afterAll(async () => {
  await pglite.close();
});

async function start(options: { redis?: RedisLike; db?: Db } = {}) {
  const db = options.db ?? (drizzle(pglite) as unknown as Db);
  app = await buildApp({ env, db, redis: options.redis ?? okRedis });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /health", () => {
  it("DB (PGlite) va Redis ishlasa — 200 va Result formatida", async () => {
    const response = await (await start()).inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      data: { status: "ok", db: "ok", redis: "ok", version: SERVER_VERSION },
    });
  });

  it("Redis xato bersa — 503, SYS_INTERNAL va komponentlar holati", async () => {
    const brokenRedis: RedisLike = {
      ping: async () => {
        throw new Error("ECONNREFUSED");
      },
      quit: async () => "OK",
    };
    const response = await (await start({ redis: brokenRedis })).inject("/health");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "SYS_INTERNAL", details: { db: "ok", redis: "error", status: "degraded" } },
    });
  });

  it("DB xato bersa — 503", async () => {
    const brokenDb = {
      execute: async () => {
        throw new Error("connection terminated");
      },
    } as unknown as Db;
    const response = await (await start({ db: brokenDb })).inject("/health");
    expect(response.statusCode).toBe(503);
    expect(response.json().error.details).toMatchObject({ db: "error", redis: "ok" });
  });
});

describe("xato formati (§8)", () => {
  it("noma'lum yo'l — 404 SYS_NOT_FOUND", async () => {
    const response = await (await start()).inject("/api/nope");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      ok: false,
      error: { code: "SYS_NOT_FOUND", message: "GET /api/nope" },
    });
  });

  it("kutilmagan xato — 500 SYS_INTERNAL, ichki tafsilot oshkor qilinmaydi", async () => {
    const instance = await start();
    instance.get("/boom", async () => {
      throw new Error("ichki sir: password=123");
    });
    const response = await instance.inject("/boom");
    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe("SYS_INTERNAL");
    expect(response.body).not.toContain("password");
  });
});

describe("withTimeout", () => {
  it("vaqtida tugasa natija qaytadi", async () => {
    await expect(withTimeout(Promise.resolve(5), 50, "x")).resolves.toBe(5);
  });

  it("tugamasa TimeoutError", async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 20, "ae op")).rejects.toBeInstanceOf(TimeoutError);
  });
});
