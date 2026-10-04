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
