/**
 * Musiqa kutubxonasini kod orqali to'ldirish (P8.06).
 *   pnpm --filter @aes/server seed:music <papka> [meta.json|meta.csv]
 * meta (ixtiyoriy) — fayl nomi bo'yicha: file, title, category, description, tags ("a;b"), bpm, loopable.
 * Berilmasa: nom fayldan, kategoriya — papka nomi. Davomiylik: ffprobe (PATH'da) yoki WAV sarlavhasi.
 * Fayllar serverning faol storage'iga yoziladi (admin → Storage): Railway volume bo'lsa skriptni serverda,
 * R2 bo'lsa istalgan joydan (`DATABASE_PUBLIC_URL` bilan) ishga tushiring. Takroriy fayl (sha256) o'tkaziladi.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import Fastify from "fastify";
import { wavDuration } from "../src/audio/dfn";
import type { AppContext } from "../src/context";
import { createDb } from "../src/db/client";
import { loadEnv } from "../src/env";
import { MusicLibrary } from "../src/music/library";
import { createStorage } from "../src/storage";
import { StorageSettings } from "../src/storage/settings";

const AUDIO = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

interface Meta {
  file: string;
  title?: string;
  category?: string;
  description?: string;
  tags?: string[] | string;
  bpm?: number | string;
  loopable?: boolean | string;
}

function parseCsv(text: string): Meta[] {
  const [head, ...lines] = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const cols = (head ?? "").split(",").map((c) => c.trim());
  return lines.map((line) => {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? "").trim()])) as unknown as Meta;
  });
}

function duration(path: string, bytes: Buffer): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
      { encoding: "utf8" },
    );
    const value = Number(out.trim());
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // ffprobe yo'q — WAV sarlavhasi
  }
  return wavDuration(bytes);
}

const [dir, metaFile] = process.argv.slice(2);
if (dir === undefined) {
  console.error("Foydalanish: seed:music <papka> [meta.json|meta.csv]");
  process.exit(1);
}
const metas = new Map<string, Meta>();
if (metaFile !== undefined) {
  const text = readFileSync(metaFile, "utf8");
  const list = metaFile.endsWith(".csv") ? parseCsv(text) : (JSON.parse(text) as Meta[]);
  for (const meta of list) metas.set(meta.file, meta);
}

const env = loadEnv();
const handle = createDb(process.env.DATABASE_PUBLIC_URL ?? env.DATABASE_URL);
const log = Fastify({ logger: { level: "warn" } }).log;
const storage = createStorage(env, log, () => new Date());
const ctx = { env, db: handle.db, now: () => new Date(), storage } as unknown as AppContext;
await new StorageSettings(ctx, storage, log).load();
const library = new MusicLibrary(ctx);
console.log(`Storage: ${storage.driver}`);

let added = 0;
let skipped = 0;
try {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (!statSync(path).isFile() || !AUDIO.has(extname(name).toLowerCase())) continue;
    const meta = metas.get(name) ?? { file: name };
    const bytes = readFileSync(path);
    const seconds = duration(path, bytes);
    if (seconds === null) {
      console.warn(`o'tkazildi (davomiylik noma'lum, ffprobe o'rnating): ${name}`);
      skipped += 1;
      continue;
    }
    const tags = Array.isArray(meta.tags)
      ? meta.tags
      : (meta.tags ?? "")
          .split(/[;|]/)
          .map((t) => t.trim())
          .filter(Boolean);
    const { created } = await library.add({
      bytes,
      ext: extname(name),
      title: meta.title || basename(name, extname(name)).replace(/[_-]+/g, " "),
      category: meta.category || basename(dir),
      description: meta.description ?? "",
      tags,
      durationS: seconds,
      bpm: meta.bpm === undefined || meta.bpm === "" ? null : Number(meta.bpm),
      loopable: meta.loopable === true || meta.loopable === "true" || meta.loopable === "1",
      source: "seed",
      status: "public",
    });
    if (created) added += 1;
    else skipped += 1;
    console.log(`${created ? "+" : "="} ${name} (${seconds.toFixed(1)} s)`);
  }
} finally {
  await handle.close();
}
console.log(`Qo'shildi: ${added}, o'tkazildi: ${skipped}`);
