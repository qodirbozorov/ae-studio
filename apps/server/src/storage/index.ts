import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import { SwitchStorage } from "./switch";

export * from "./storage";
export { LocalStorage } from "./local";
export { S3Storage } from "./s3";
export { SwitchStorage } from "./switch";
export type { StorageDriverName } from "./switch";

/**
 * Lokal disk (Railway volume, `STORAGE_DIR`) doim bor; S3_* to'liq berilsa R2 ham ulanadi va faol bo'ladi.
 * Keyin admin panel (`system_settings`) env ustidan yozadi va drayverni almashtiradi.
 */
export function createStorage(env: Env, log: FastifyBaseLogger, now: () => Date): SwitchStorage {
  const local = new LocalStorage(
    env.STORAGE_DIR ?? join(process.cwd(), ".storage"),
    env.PUBLIC_URL,
    now,
  );
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY) {
    const s3 = new S3Storage({
      endpoint: S3_ENDPOINT,
      bucket: S3_BUCKET,
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    });
    return new SwitchStorage(local, s3, "s3");
  }
  if (env.NODE_ENV === "production" && env.STORAGE_DIR === undefined) {
    log.warn("STORAGE_DIR va R2 sozlanmagan: fayllar konteyner diskida (qayta deployda o'chadi)");
  }
  return new SwitchStorage(local, null, "local");
}
