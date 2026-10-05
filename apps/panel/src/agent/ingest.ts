/**
 * INGEST (§3): `source/` dagi fayllarni skanerlaydi → tur, kalit, hash, ffprobe metadata, thumbnail.
 * Natija `asset.scanned` xabari sifatida serverga ketadi. Buzuq fayl skanerlashni to'xtatmaydi —
 * u `error` bilan belgilanadi (Claude uni rad etishi yoki almashtirishi mumkin, §3 INGEST gate).
 */
import { createHash } from "node:crypto";
import { createReadStream, promises as fsp } from "node:fs";
import path from "node:path";
import type { AesError, PanelMessageOf } from "@aes/shared";
import { makeError } from "@aes/shared";
import { FfmpegError, probe, thumbnail } from "./ffmpeg";
import type { Binaries, MediaMeta } from "./ffmpeg";

export type AssetKind = "video" | "image" | "audio" | "other";
export type ScannedAsset = PanelMessageOf<"asset.scanned">["assets"][number];

const KINDS: Record<string, AssetKind> = {};
for (const ext of ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mxf", "mpg", "mpeg"])
  KINDS[ext] = "video";
for (const ext of ["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "psd", "heic"])
  KINDS[ext] = "image";
for (const ext of ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "aif", "aiff"])
  KINDS[ext] = "audio";

export function kindOf(file: string): AssetKind {
  return KINDS[path.extname(file).slice(1).toLowerCase()] ?? "other";
}

/** Fayl nomidan `asset:` kaliti: `Clip 01 (final).MP4` → `clip_01_final`. */
export function keyFromName(file: string): string {
  const base = path.basename(file, path.extname(file));
  const slug = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return slug === "" ? "asset" : /^[a-z0-9]/.test(slug) ? slug : `a_${slug}`;
}

/** Katta fayllar uchun tez hash: hajm + boshidan va oxiridan 1 MB (8 MB dan kichiklar — to'liq). */
export async function fastHash(file: string, size: number): Promise<string> {
  const hash = createHash("sha256");
  const LIMIT = 8 * 1024 * 1024;
  const CHUNK = 1024 * 1024;
  if (size <= LIMIT) {
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    return "s:" + hash.digest("hex");
  }
  hash.update(String(size));
  const handle = await fsp.open(file, "r");
  try {
    const buffer = Buffer.alloc(CHUNK);
    await handle.read(buffer, 0, CHUNK, 0);
    hash.update(buffer);
    await handle.read(buffer, 0, CHUNK, size - CHUNK);
    hash.update(buffer);
  } finally {
    await handle.close();
  }
  return "f:" + hash.digest("hex");
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

export interface IngestOptions {
  root: string;
  bins: Binaries;
  /** Thumbnail tayyor bo'lganda storage'ga yuklaydi va storage kalitini qaytaradi. */
  uploadThumb?: (file: string, hash: string) => Promise<string | null>;
}

/** `source/` ni skanerlaydi. Kalitlar barqaror: fayllar alfavit tartibida, takrorlar `_2`, `_3`... */
export async function scanSource(options: IngestOptions): Promise<ScannedAsset[]> {
  const sourceDir = path.join(options.root, "source");
  const thumbsDir = path.join(options.root, ".aestudio", "thumbs");
  await fsp.mkdir(thumbsDir, { recursive: true });
  const files: string[] = [];
  await walk(sourceDir, files);
  // Ordinal tartib (lokalga bog'liq emas): kalitlar har qanday mashinada bir xil chiqadi.
  const rel = (file: string) => path.relative(options.root, file).split(path.sep).join("/");
  files.sort((a, b) => (rel(a) < rel(b) ? -1 : rel(a) > rel(b) ? 1 : 0));

  const used = new Set<string>();
  const assets: ScannedAsset[] = [];
  for (const file of files) {
    let key = keyFromName(file);
    for (let n = 2; used.has(key); n++) key = `${keyFromName(file)}_${n}`;
    used.add(key);

    const stat = await fsp.stat(file);
    const kind = kindOf(file);
    const local = rel(file);
    const asset: ScannedAsset = {
      key,
      local_path: local,
      kind,
      size: stat.size,
      mtime_ms: stat.mtimeMs,
      hash: await fastHash(file, stat.size),
      meta: {},
    };
    if (kind === "other") {
      asset.error = makeError("ASSET_UNSUPPORTED", `Qo'llanmaydigan fayl: ${local}`);
      assets.push(asset);
      continue;
    }
    try {
      const meta: MediaMeta = await probe(options.bins, file);
      asset.meta = { ...meta };
      if (kind !== "audio" && meta.has_video) {
        const thumb = path.join(thumbsDir, `${asset.hash.replace(/[^a-z0-9]/gi, "")}.jpg`);
        const at = kind === "video" && meta.duration !== null ? meta.duration * 0.1 : undefined;
        await thumbnail(options.bins, file, thumb, { at });
        const key2 = await options.uploadThumb?.(thumb, asset.hash);
        if (key2) asset.thumb_key = key2;
      }
    } catch (error) {
      // ffmpeg umuman yo'q bo'lsa — butun skanerlash to'xtaydi (har fayl xatosi emas).
      if (error instanceof FfmpegError && error.error.code === "ENV_FFMPEG_MISSING") throw error;
      asset.error =
        error instanceof FfmpegError
          ? error.error
          : (makeError(
              "SYS_INTERNAL",
              error instanceof Error ? error.message : String(error),
            ) as AesError);
    }
    assets.push(asset);
  }
  return assets;
}
