import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./storage";

export * from "./storage";
export { LocalStorage } from "./local";
export { S3Storage } from "./s3";

/** S3_* to'liq berilsa S3 (R2/Railway bucket), aks holda lokal disk (dev). */
export function createStorage(env: Env, log: FastifyBaseLogger, now: () => Date): Storage {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY } = env;
  if (S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY && S3_SECRET_KEY) {
    return new S3Storage({
      endpoint: S3_ENDPOINT,
      bucket: S3_BUCKET,
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    });
  }
  if (env.NODE_ENV === "production") {
    log.warn("S3 sozlanmagan: lokal disk ishlatiladi (Railway'da qayta deployda o'chadi)");
  }
  return new LocalStorage(env.STORAGE_DIR ?? join(process.cwd(), ".storage"), env.PUBLIC_URL, now);
}
