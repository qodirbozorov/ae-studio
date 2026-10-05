/**
 * Object storage (§4.4, §6): fayllar faqat pre-signed URL orqali (15 daqiqa) yuklanadi/olinadi.
 * Drayverlar: S3-mos (Cloudflare R2 yoki Railway bucket, Q3) va lokal (dev/test, server o'zi imzolaydi).
 */

export const PRESIGN_TTL_S = 15 * 60;

export const STORAGE_KINDS = ["thumbs", "frames", "audio-in", "audio-out"] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

export interface StoredObject {
  size: number;
}

export interface Storage {
  readonly driver: "s3" | "local";
  /** PUT uchun imzolangan URL (panel faylni shu manzilga yuklaydi). */
  presignPut(key: string, options?: { contentType?: string; ttlS?: number }): Promise<string>;
  /** GET uchun imzolangan URL (panel yoki Claude o'qiydi). */
  presignGet(key: string, options?: { ttlS?: number }): Promise<string>;
  /** Mavjud bo'lsa hajmi, aks holda null. */
  head(key: string): Promise<StoredObject | null>;
  /** Server o'zi o'qishi uchun (masalan Claude'ga rasm berish). */
  getBytes(key: string): Promise<Buffer | null>;
  putBytes(key: string, data: Buffer, contentType?: string): Promise<void>;
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** `u/<user>/p/<project>/<kind>/<hash>.<ext>` (§5 "Storage kalitlari"). */
export function storageKey(input: {
  userId: string;
  projectId: string;
  kind: StorageKind;
  hash: string;
  ext: string;
}): string {
  const ext = input.ext.replace(/^\./, "").toLowerCase();
  for (const [name, value] of [
    ["userId", input.userId],
    ["projectId", input.projectId],
    ["hash", input.hash],
    ["ext", ext],
  ] as const) {
    if (!SEGMENT_RE.test(value) || value.includes("..")) {
      throw new Error(`storageKey: noto'g'ri ${name}: ${value}`);
    }
  }
  if (!STORAGE_KINDS.includes(input.kind)) throw new Error(`storageKey: noto'g'ri kind`);
  return `u/${input.userId}/p/${input.projectId}/${input.kind}/${input.hash}.${ext}`;
}

/** Kalit faqat ruxsat etilgan belgilar va segmentlardan iborat (path traversal yo'q). */
export function isValidKey(key: string): boolean {
  if (key.length === 0 || key.length > 512 || key.startsWith("/")) return false;
  return key.split("/").every((segment) => SEGMENT_RE.test(segment) && segment !== "..");
}
