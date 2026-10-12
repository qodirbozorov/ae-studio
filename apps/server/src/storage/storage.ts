/**
 * Object storage (§4.4, §6): fayllar faqat pre-signed URL orqali (15 daqiqa) yuklanadi/olinadi.
 * Drayverlar: S3-mos (Cloudflare R2 yoki Railway bucket, Q3) va lokal (dev/test, server o'zi imzolaydi).
 */

export const PRESIGN_TTL_S = 15 * 60;

/** `docs` — plan va hisobot nusxalari (sha256 nomli, ish papkasidagi `.aestudio/` ga yuklab olinadi). */
export const STORAGE_KINDS = ["thumbs", "frames", "audio-in", "audio-out", "docs"] as const;
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
  /** O'chirish (backup rotatsiyasi, P5.13); yo'q bo'lsa xato emas. */
  delete(key: string): Promise<void>;
  /** Prefiks bo'yicha kalitlar (tartiblangan). */
  list(prefix: string): Promise<string[]>;
}

export interface BrowseEntry {
  key: string;
  size: number;
  modified: string | null;
}

export interface BrowseResult {
  prefix: string;
  /** Ichki papkalar (to'liq prefiks, `/` bilan tugaydi). */
  folders: string[];
  files: BrowseEntry[];
  /** Keyingi sahifa uchun; null — oxiri. */
  cursor: string | null;
}

/** Admin fayl explorer'i uchun: bitta daraja (papka) bo'yicha ko'rish. */
export interface Browsable {
  browse(prefix: string, options?: { cursor?: string; limit?: number }): Promise<BrowseResult>;
}

/** "" yoki `a/b/` ko'rinishidagi xavfsiz prefiks. */
export function isValidPrefix(prefix: string): boolean {
  if (prefix === "") return true;
  return prefix.endsWith("/") && isValidKey(prefix.slice(0, -1));
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  pdf: "application/pdf",
};

export function mimeOf(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
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
