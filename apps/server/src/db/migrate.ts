import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `drizzle/meta/_journal.json` joylashgan papkani yuqoriga qarab qidiradi:
 * tsx'da `src/db` dan, bundle'da `dist` dan ishga tushganda ham topiladi.
 */
export function findMigrationsDir(from = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, "drizzle");
    if (existsSync(join(candidate, "meta", "_journal.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("drizzle migratsiya papkasi topilmadi (qidiruv boshi: " + from + ")");
}
