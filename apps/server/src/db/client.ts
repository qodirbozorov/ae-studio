import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

/** postgres-js (production) va PGlite (testlar) uchun umumiy tip. */
export type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export function createDb(url: string): DbHandle {
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return {
    db: drizzle(client) as unknown as Db,
    close: () => client.end({ timeout: 5 }),
  };
}
