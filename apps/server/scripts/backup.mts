/**
 * DB backup/tiklash CLI (P5.13).
 *   tsx scripts/backup.mts dump <fayl.ndjson.gz>      — DATABASE_URL dagi bazani faylga
 *   tsx scripts/backup.mts restore <fayl.ndjson.gz>   — bo'sh (migratsiyalangan) bazaga tiklash
 * Server ichida avtomatik backup storage'ga yoziladi (system/backups/, BACKUP_INTERVAL_H, BACKUP_KEEP).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb } from "../src/db/client";
import { findMigrationsDir } from "../src/db/migrate";
import { dumpDatabase, restoreDatabase } from "../src/ops/backup";

const [command, file] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (url === undefined || file === undefined || (command !== "dump" && command !== "restore")) {
  console.error("Foydalanish: DATABASE_URL=… tsx scripts/backup.mts dump|restore <fayl.ndjson.gz>");
  process.exit(1);
}
const handle = createDb(url);
try {
  if (command === "dump") {
    const { data, stats } = await dumpDatabase(handle.db);
    writeFileSync(file, data);
    console.log(
      `backup: ${file} (${stats.tables} jadval, ${stats.rows} qator, ${data.length} bayt)`,
    );
  } else {
    // Bo'sh bazada sxema bo'lishi kerak (migratsiyalar idempotent).
    const client = postgres(url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(client), { migrationsFolder: findMigrationsDir() });
    await client.end({ timeout: 5 });
    const stats = await restoreDatabase(handle.db, readFileSync(file));
    console.log(`tiklandi: ${stats.tables} jadval, ${stats.rows} qator`);
  }
} finally {
  await handle.close();
}
