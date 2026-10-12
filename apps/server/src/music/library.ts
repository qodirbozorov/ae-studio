/**
 * Musiqa kutubxonasi (P8.06). Fayllar storage'da `music/<sha12>.<ext>`, ma'lumot `music_tracks` da.
 * Qidiruv — nom/kategoriya/izoh/teglar bo'yicha so'zlar (foydalanuvchiga ko'rinmaydi, M2). Ko'rinadiganlar:
 * `public` va foydalanuvchining o'z `candidate` lari.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { AppContext } from "../context";
import { musicTracks } from "../db/schema";
import { mimeOf } from "../storage";

export type MusicTrackRow = typeof musicTracks.$inferSelect;

export interface TrackInput {
  bytes: Buffer;
  ext: string;
  title: string;
  category: string;
  description?: string;
  tags?: string[];
  durationS: number;
  bpm?: number | null;
  loopable?: boolean;
  source: "seed" | "admin" | "generated";
  status?: "candidate" | "public" | "hidden";
  ownerUserId?: string | null;
  audioTaskId?: string | null;
  prompt?: string | null;
}

export interface SearchInput {
  query?: string;
  category?: string;
  /** Kamida shuncha soniya (qisqa trek loop qilinadi, lekin uzunrog'i afzal). */
  minSeconds?: number;
  limit?: number;
}

export function trackView(row: MusicTrackRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    tags: row.tags,
    duration_s: Math.round(row.durationS * 10) / 10,
    bpm: row.bpm,
    loopable: row.loopable,
    status: row.status,
  };
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);

export class MusicLibrary {
  constructor(private readonly ctx: Pick<AppContext, "db" | "storage" | "now">) {}

  async get(id: string): Promise<MusicTrackRow | null> {
    const [row] = await this.ctx.db.select().from(musicTracks).where(eq(musicTracks.id, id));
    return row ?? null;
  }

  /** Foydalanuvchi ishlata oladimi: ommaviy yoki o'zining (yashirin emas). */
  visibleTo(row: MusicTrackRow, userId: string): boolean {
    return row.status === "public" || (row.status === "candidate" && row.ownerUserId === userId);
  }

  async search(userId: string, input: SearchInput = {}) {
    const visible = or(
      eq(musicTracks.status, "public"),
      and(eq(musicTracks.status, "candidate"), eq(musicTracks.ownerUserId, userId)),
    );
    const where = input.category
      ? and(visible, sql`lower(${musicTracks.category}) = ${input.category.toLowerCase()}`)
      : visible;
    const rows = await this.ctx.db
      .select()
      .from(musicTracks)
      .where(where)
      .orderBy(desc(musicTracks.createdAt))
      .limit(500);
    const terms = words(input.query ?? "");
    const scored = rows.map((row) => {
      const haystack = words(
        `${row.title} ${row.category} ${row.description} ${row.tags.join(" ")}`,
      );
      const score = terms.reduce(
        (sum, term) =>
          sum +
          (haystack.some((word) => word === term)
            ? 2
            : haystack.some((w) => w.startsWith(term))
              ? 1
              : 0),
        0,
      );
      const longEnough = input.minSeconds === undefined || row.durationS >= input.minSeconds;
      return { row, score: score + (longEnough ? 0.5 : 0) + (row.loopable ? 0.25 : 0) };
    });
    const matches = scored
      .filter((item) => terms.length === 0 || item.score >= 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 10)
      .map((item) => trackView(item.row));
    const categories = [...new Set(rows.map((row) => row.category))].sort();
    return { tracks: matches, categories, total_visible: rows.length };
  }

  /** Fayl va ma'lumot qo'shadi. Xuddi shu fayl (sha256) bor bo'lsa — mavjud yozuv qaytadi. */
  async add(input: TrackInput): Promise<{ row: MusicTrackRow; created: boolean }> {
    const sha = createHash("sha256").update(input.bytes).digest("hex");
    const [existing] = await this.ctx.db
      .select()
      .from(musicTracks)
      .where(eq(musicTracks.sha256, sha));
    if (existing !== undefined) return { row: existing, created: false };
    const ext = input.ext.replace(/^\./, "").toLowerCase();
    const key = `music/${sha.slice(0, 24)}.${ext}`;
    if ((await this.ctx.storage.head(key)) === null) {
      await this.ctx.storage.putBytes(key, input.bytes, mimeOf(key));
    }
    const [row] = await this.ctx.db
      .insert(musicTracks)
      .values({
        title: input.title.slice(0, 200),
        category: input.category.slice(0, 80),
        description: (input.description ?? "").slice(0, 1000),
        tags: (input.tags ?? []).slice(0, 20).map((tag) => tag.slice(0, 40)),
        durationS: input.durationS,
        bpm: input.bpm ?? null,
        loopable: input.loopable ?? false,
        source: input.source,
        status: input.status ?? "public",
        ownerUserId: input.ownerUserId ?? null,
        audioTaskId: input.audioTaskId ?? null,
        prompt: input.prompt ?? null,
        storageKey: key,
        contentType: mimeOf(key),
        ext,
        sha256: sha,
        createdAt: this.ctx.now(),
        updatedAt: this.ctx.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (row === undefined) {
      const [again] = await this.ctx.db
        .select()
        .from(musicTracks)
        .where(eq(musicTracks.sha256, sha));
      return { row: again!, created: false };
    }
    return { row, created: true };
  }

  /**
   * Tashqi xizmatda generatsiya qilingan musiqa → kutubxonaga "nomzod" (M: admin tahrirlab ommaviy qiladi).
   * Nom/kategoriya/izohni Claude `music_generate` da beradi; bo'lmasa prompt'dan.
   */
  async collectGenerated(task: {
    id: string;
    userId: string;
    params: unknown;
    storageKey: string | null;
    ext: string | null;
    durationMs: number | null;
  }): Promise<MusicTrackRow | null> {
    const params = (task.params ?? {}) as Record<string, unknown>;
    if (params.tier === "basic" || params.library_track !== undefined) return null;
    if (task.storageKey === null || task.ext === null || task.durationMs === null) return null;
    const bytes = await this.ctx.storage.getBytes(task.storageKey);
    if (bytes === null) return null;
    const prompt = typeof params.prompt === "string" ? params.prompt : "";
    const text = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
    const { row } = await this.add({
      bytes,
      ext: task.ext,
      title: text("title") || prompt.slice(0, 60) || "Generatsiya",
      category: text("category") || "generated",
      description: text("description") || prompt,
      durationS: task.durationMs / 1000,
      source: "generated",
      status: "candidate",
      ownerUserId: task.userId,
      audioTaskId: task.id,
      prompt,
    });
    return row;
  }
}
