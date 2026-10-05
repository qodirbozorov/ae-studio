import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "../../src/db/client";
import { findMigrationsDir } from "../../src/db/migrate";
import * as schema from "../../src/db/schema";

export interface TestDb {
  db: Db;
  pglite: PGlite;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** Migratsiyalar qo'llangan toza PGlite (WASM Postgres) bazasi. */
export async function createTestDb(): Promise<TestDb> {
  const pglite = await PGlite.create();
  const drizzleDb = drizzle(pglite, { schema });
  const run = () => migrate(drizzleDb, { migrationsFolder: findMigrationsDir() });
  await run();
  return {
    db: drizzleDb as unknown as Db,
    pglite,
    migrate: run,
    close: () => pglite.close(),
  };
}

/** Postgres xato kodi (23505 unique, 23503 FK, 23514 check) — drizzle uni `cause` ga o'raydi. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function expectPgError(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error("Postgres xatosi kutilgan edi");
}

/**
 * Haqiqiy production drayveri (postgres.js) bilan test DB: PGlite Postgres wire-protocol orqali ochiladi.
 * PGlite to'g'ridan-to'g'ri drayveri ba'zi xatolarni yashiradi (masalan raw `sql` ichidagi Date).
 */
export async function createWireTestDb(): Promise<TestDb> {
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const { drizzle: drizzlePg } = await import("drizzle-orm/postgres-js");
  const { migrate: migratePg } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;

  const pglite = await PGlite.create();
  const port = 40_000 + Math.floor(Math.random() * 20_000);
  const server = new PGLiteSocketServer({ db: pglite, port, host: "127.0.0.1" });
  await server.start();
  const client = postgres(`postgresql://postgres@127.0.0.1:${port}/postgres`, {
    max: 1,
    onnotice: () => {},
  });
  const db = drizzlePg(client, { schema });
  const run = () => migratePg(db, { migrationsFolder: findMigrationsDir() });
  await run();
  return {
    db: db as unknown as Db,
    pglite,
    migrate: run,
    close: async () => {
      await client.end({ timeout: 2 });
      await server.stop();
      await pglite.close();
    },
  };
}
