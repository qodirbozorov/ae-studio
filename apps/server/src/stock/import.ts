/**
 * Unsplash rasmini loyihaga olish: panel faylni Unsplash CDN'dan to'g'ridan-to'g'ri `source/unsplash/` ga yuklaydi
 * (sha256 tekshiruvi bilan, ustiga yozmaydi), server asset yozuvini darhol qo'shadi (skanni kutmasdan), atribusiyani
 * `stock_photos` ga yozadi va Unsplash download tracking'ni (loyiha × rasm uchun bir marta) yuboradi.
 */
import { randomUUID } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../context";
import type { projects } from "../db/schema";
import { assets, stockPhotos } from "../db/schema";
import { photoView, sizedUrl } from "./unsplash";
import type { PhotoView } from "./unsplash";

type ProjectRow = typeof projects.$inferSelect;
type Ctx = Pick<AppContext, "db" | "now" | "hub" | "unsplash">;

const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** Panel skaneri bilan bir xil kalit (`keyFromName`): `unsplash_AbC-1` → `unsplash_abc_1`. */
export function stockKey(photoId: string): string {
  const slug = `unsplash_${photoId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  return slug;
}

export interface ImportedPhoto extends PhotoView {
  key: string;
  ref: string;
  local_path: string;
  /** Yuklangan faylning o'lchami (kenglik bo'yicha kichraytirilgan). */
  file_width: number;
  file_height: number;
  already: boolean;
}

export async function importUnsplash(
  ctx: Ctx,
  project: ProjectRow,
  deviceId: string,
  photoId: string,
  width: number,
): Promise<Result<ImportedPhoto>> {
  const [existing] = await ctx.db
    .select()
    .from(stockPhotos)
    .where(
      and(
        eq(stockPhotos.projectId, project.id),
        eq(stockPhotos.provider, "unsplash"),
        eq(stockPhotos.photoId, photoId),
      ),
    )
    .limit(1);

  const found = await ctx.unsplash.photo(photoId);
  if (!found.ok) {
    if (existing === undefined) return found;
    // API ishlamasa ham avval olingan rasm loyihada bor
    return ok({ ...fromRow(existing), already: true });
  }
  const photo = found.data;
  const view = photoView(photo);
  if (existing !== undefined) {
    if (existing.downloadTrackedAt === null && (await ctx.unsplash.trackDownload(photo))) {
      await ctx.db
        .update(stockPhotos)
        .set({ downloadTrackedAt: ctx.now() })
        .where(eq(stockPhotos.id, existing.id));
    }
    return ok({ ...view, ...pick(existing), already: true });
  }

  const sized = sizedUrl(photo, width);
  const fileHeight = Math.round((sized.width * photo.height) / photo.width);
  const fingerprint = await ctx.unsplash.fingerprint(sized.url);
  if (!fingerprint.ok) return fingerprint;

  const key = stockKey(photo.id);
  const dest = `source/unsplash/${key}.jpg`;
  const reply = await ctx.hub.request(
    deviceId,
    {
      type: "file.download",
      request_id: randomUUID(),
      url: sized.url,
      sha256: fingerprint.data.sha256,
      dest,
      size: fingerprint.data.size,
    },
    DOWNLOAD_TIMEOUT_MS,
  );
  if (!reply.ok) {
    if (reply.error.code === "ENV_AGENT_OFFLINE") return reply;
    return fail(reply.error.code, `${dest}: ${reply.error.message ?? reply.error.code}`);
  }

  const meta = {
    width: sized.width,
    height: fileHeight,
    size: fingerprint.data.size,
    provider: "unsplash",
    photo_id: photo.id,
  };
  await ctx.db
    .insert(assets)
    .values({
      projectId: project.id,
      key,
      localPath: dest,
      kind: "image",
      meta,
      hash: fingerprint.data.sha256,
      status: "ok",
    })
    .onConflictDoUpdate({
      target: [assets.projectId, assets.key],
      set: {
        localPath: dest,
        kind: "image",
        meta,
        hash: fingerprint.data.sha256,
        status: "ok",
        updatedAt: ctx.now(),
      },
    });

  const tracked = await ctx.unsplash.trackDownload(photo);
  await ctx.db
    .insert(stockPhotos)
    .values({
      projectId: project.id,
      provider: "unsplash",
      photoId: photo.id,
      assetKey: key,
      localPath: dest,
      width: sized.width,
      height: fileHeight,
      author: view.author,
      authorUrl: view.author_url,
      photoUrl: view.photo_url,
      meta: {
        description: view.description,
        color: view.color,
        original: { width: photo.width, height: photo.height },
      },
      downloadTrackedAt: tracked ? ctx.now() : null,
    })
    .onConflictDoNothing();

  return ok({
    ...view,
    key,
    ref: `asset:${key}`,
    local_path: dest,
    file_width: sized.width,
    file_height: fileHeight,
    already: false,
  });
}

type StockRow = typeof stockPhotos.$inferSelect;

function pick(row: StockRow) {
  return {
    key: row.assetKey,
    ref: `asset:${row.assetKey}`,
    local_path: row.localPath,
    file_width: row.width,
    file_height: row.height,
  };
}

function fromRow(row: StockRow): Omit<ImportedPhoto, "already"> {
  const meta = row.meta as {
    description?: string | null;
    color?: string | null;
    original?: { width: number; height: number };
  };
  return {
    id: row.photoId,
    description: meta.description ?? null,
    width: meta.original?.width ?? row.width,
    height: meta.original?.height ?? row.height,
    color: meta.color ?? null,
    author: row.author,
    author_url: row.authorUrl,
    photo_url: row.photoUrl,
    thumb: "",
    attribution: `Photo by ${row.author} on Unsplash`,
    ...pick(row),
  };
}

/** Loyihadagi Unsplash rasmlari — nashr va hisobot uchun mualliflar ro'yxati. */
export async function projectCredits(ctx: Pick<AppContext, "db">, projectId: string) {
  const rows = await ctx.db
    .select()
    .from(stockPhotos)
    .where(eq(stockPhotos.projectId, projectId))
    .orderBy(stockPhotos.createdAt);
  return rows.map((row) => ({
    key: row.assetKey,
    ref: `asset:${row.assetKey}`,
    photo_id: row.photoId,
    author: row.author,
    author_url: row.authorUrl,
    photo_url: row.photoUrl,
    attribution: `Photo by ${row.author} on Unsplash`,
    download_tracked: row.downloadTrackedAt !== null,
  }));
}
