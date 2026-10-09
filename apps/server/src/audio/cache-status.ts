/**
 * Kesh holati (#8, update-technicalguidline §5.9): vazifa `eleven_cache` da bormi — bor bo'lsa kredit sarflanmaydi.
 * Kirish fayli bor vazifalar (STT, isolation …) uchun hash ajratilgan audio sha256'iga bog'liq va oldindan
 * noma'lum — `null` (taxminda kreditli deb hisoblanadi).
 */
import type { AudioKind } from "@aes/shared";
import { inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { elevenCache } from "../db/schema";
import { paramsHash } from "./service";

export interface CacheProbe {
  kind: AudioKind;
  params: Record<string, unknown>;
  /** Kirish fayli bor (hash oldindan noma'lum). */
  hasInput?: boolean;
}

export async function cacheFlags(
  db: Db,
  items: readonly CacheProbe[],
): Promise<(boolean | null)[]> {
  const hashes = items.map((item) =>
    item.hasInput === true ? null : paramsHash(item.kind, item.params),
  );
  const known = hashes.filter((h): h is string => h !== null);
  const hits =
    known.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ hash: elevenCache.paramsHash })
              .from(elevenCache)
              .where(inArray(elevenCache.paramsHash, known))
          ).map((row) => row.hash),
        );
  return hashes.map((hash) => (hash === null ? null : hits.has(hash)));
}
