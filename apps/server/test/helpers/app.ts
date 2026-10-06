import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import type { AppDeps } from "../../src/app";
import { SESSION_TTL_MS } from "../../src/auth/session";
import { issueToken } from "../../src/auth/tokens";
import { users } from "../../src/db/schema";
import { loadEnv } from "../../src/env";
import { createTestDb } from "./db";
import type { TestDb } from "./db";

export interface TestApp {
  app: FastifyInstance;
  db: TestDb;
  clock: { now: Date; advance(ms: number): void };
  close(): Promise<void>;
}

/** Migratsiyalangan PGlite va boshqariladigan soat bilan ilova. */
export async function createTestApp(
  env: Record<string, string> = {},
  db?: TestDb,
  extra: Pick<AppDeps, "oauthFetcher" | "elevenOptions" | "audioOptions" | "telegramOptions"> = {},
): Promise<TestApp> {
  const testDb = db ?? (await createTestDb());
  const clock = {
    now: new Date("2026-10-05T10:00:00Z"),
    advance(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
  const app = await buildApp({
    env: loadEnv({
      DATABASE_URL: "postgresql://test@localhost/test",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      PUBLIC_URL: "https://aes.test",
      STORAGE_DIR: mkdtempSync(join(tmpdir(), "aes-storage-")),
      MASTER_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      ...env,
    }),
    db: testDb.db,
    redis: { ping: async () => "PONG", quit: async () => "OK" },
    now: () => clock.now,
    ...extra,
  });
  return {
    app,
    db: testDb,
    clock,
    close: async () => {
      await app.close();
      if (db === undefined) await testDb.close();
    },
  };
}

/**
 * Test foydalanuvchisi va kabinet sessiyasi. `label` (eski testlarda email ko'rinishida) — foydalanuvchini
 * keyin `users.email` bo'yicha topish uchun. Haqiqiy Telegram kirish oqimi `auth.test.ts` da tekshiriladi.
 */
export async function login(t: TestApp, label: string): Promise<string> {
  let [user] = await t.db.db.select().from(users).where(eq(users.email, label));
  if (user === undefined) {
    [user] = await t.db.db.insert(users).values({ email: label, name: label }).returning();
  }
  const session = await issueToken(t.db.db, {
    kind: "session",
    ttlMs: SESSION_TTL_MS,
    now: t.clock.now,
    userId: user!.id,
  });
  return `aes_session=${session.token}`;
}
