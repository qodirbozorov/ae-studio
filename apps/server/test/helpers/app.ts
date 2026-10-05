import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import { MemoryMailer } from "../../src/auth/mailer";
import { loadEnv } from "../../src/env";
import { createTestDb } from "./db";
import type { TestDb } from "./db";

export interface TestApp {
  app: FastifyInstance;
  db: TestDb;
  mailer: MemoryMailer;
  clock: { now: Date; advance(ms: number): void };
  close(): Promise<void>;
}

/** Migratsiyalangan PGlite, xotiradagi mailer va boshqariladigan soat bilan ilova. */
export async function createTestApp(
  env: Record<string, string> = {},
  db?: TestDb,
): Promise<TestApp> {
  const testDb = db ?? (await createTestDb());
  const mailer = new MemoryMailer();
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
      ...env,
    }),
    db: testDb.db,
    redis: { ping: async () => "PONG", quit: async () => "OK" },
    mailer,
    now: () => clock.now,
  });
  return {
    app,
    db: testDb,
    mailer,
    clock,
    close: async () => {
      await app.close();
      if (db === undefined) await testDb.close();
    },
  };
}

/** Magic link oqimi: xat yuboriladi, havola ochiladi → session cookie. */
export async function login(t: TestApp, email: string): Promise<string> {
  await t.app.inject({ method: "POST", url: "/api/auth/magic-link", payload: { email } });
  const mail = t.mailer.sent.at(-1);
  const link = /https:\/\/aes\.test(\/api\/auth\/verify\?token=[^\s"]+)/.exec(
    mail?.text ?? "",
  )?.[1];
  if (link === undefined) throw new Error("magic link topilmadi");
  const response = await t.app.inject({ method: "GET", url: link });
  const cookie = response.cookies.find((c) => c.name === "aes_session");
  if (cookie === undefined) throw new Error("session cookie yo'q: " + response.body);
  t.clock.advance(31_000);
  return `aes_session=${cookie.value}`;
}
