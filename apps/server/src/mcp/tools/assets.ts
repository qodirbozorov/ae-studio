/**
 * Fayl toollari (§8): assets_scan, assets_list, asset_preview.
 * Asl media localda qoladi (D5): Claude kichraytirilgan JPG'larni (image content) ko'radi.
 */
import { randomUUID } from "node:crypto";
import { fail, ok } from "@aes/shared";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { applyScan } from "../../assets/routes";
import { assets } from "../../db/schema";
import { storageKey } from "../../storage";
import { defineTool } from "../registry";
import type { ImageBlock, ToolContext } from "../registry";
import { ownProject, requireOnline, uuidArg } from "./common";
import type { ProjectRow } from "./common";

const SCAN_WAIT_MS = 90_000;
const PREVIEW_TIMEOUT_MS = 120_000;
/** Bitta javobdagi rasmlar hajmi chegarasi (Claude kontekstini tejash). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type AssetRow = typeof assets.$inferSelect;

function presentAsset(row: AssetRow) {
  const meta = row.meta as Record<string, unknown>;
  const pick = (key: string) => (meta[key] === undefined ? null : meta[key]);
  return {
    key: row.key,
    ref: `asset:${row.key}`,
    local_path: row.localPath,
    kind: row.kind,
    status: row.status,
    width: pick("width"),
    height: pick("height"),
    duration: pick("duration"),
    fps: pick("fps"),
    has_audio: pick("has_audio"),
    error: pick("error"),
  };
}

/** Rasmlar: panel yuklagan JPG'lar storage'dan base64 ga. */
export async function previewImages(
  ctx: ToolContext,
  project: ProjectRow,
  localPath: string,
  options: { mode: "image" | "frames"; times?: number[]; count?: number; maxPx: number },
) {
  const deviceId = requireOnline(ctx, project);
  if (!deviceId.ok) return deviceId;
  const slots = options.mode === "image" ? 1 : (options.times?.length ?? options.count ?? 4);
  const uploads = await Promise.all(
    Array.from({ length: slots }, async () => {
      const key = storageKey({
        userId: project.userId,
        projectId: project.id,
        kind: "frames",
        hash: `p${randomUUID().replace(/-/g, "")}`,
        ext: "jpg",
      });
      return {
        url: await ctx.app.storage.presignPut(key, { contentType: "image/jpeg" }),
        storage_key: key,
      };
    }),
  );
  const reply = await ctx.app.hub.request(
    deviceId.data,
    {
      type: "asset.preview.request",
      request_id: randomUUID(),
      local_path: localPath,
      mode: options.mode,
      ...(options.times === undefined ? {} : { times: options.times }),
      ...(options.count === undefined ? {} : { count: options.count }),
      max_px: options.maxPx,
      uploads,
    },
    PREVIEW_TIMEOUT_MS,
  );
  if (!reply.ok) return reply;
  if (reply.data.type !== "asset.preview.ready") return fail("SYS_INTERNAL", "Kutilmagan javob");
  const images: ImageBlock[] = [];
  const frames: { time: number | null; storage_key: string; included: boolean }[] = [];
  let total = 0;
  for (const file of reply.data.files) {
    const bytes = await ctx.app.storage.getBytes(file.storage_key);
    const included = bytes !== null && total + bytes.length <= MAX_IMAGE_BYTES;
    if (included) {
      total += bytes!.length;
      images.push({ type: "image", data: bytes!.toString("base64"), mimeType: "image/jpeg" });
    }
    frames.push({ time: file.time, storage_key: file.storage_key, included });
  }
  return ok({ frames, images });
}

export const assetTools = [
  defineTool({
    name: "assets_scan",
    title: "Scan project files",
    description:
      "Asks the panel to scan the project's source/ folder with ffprobe (type, size, duration, resolution) and store thumbnails. Waits up to 90 s; if still running returns status=running — call assets_list a bit later.",
    input: z.object({ project_id: uuidArg("project_id") }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const deviceId = requireOnline(ctx, project.data);
      if (!deviceId.ok) return deviceId;
      const requestId = randomUUID();
      const reply = await ctx.app.hub.request(
        deviceId.data,
        { type: "assets.scan", request_id: requestId, project_root: project.data.rootPath },
        SCAN_WAIT_MS,
      );
      if (!reply.ok) {
        if (reply.error.code === "AE_TIMEOUT") {
          return ok({
            status: "running",
            request_id: requestId,
            hint: "assets_list ni birozdan keyin chaqiring",
          });
        }
        return reply;
      }
      if (reply.data.type !== "asset.scanned") return fail("SYS_INTERNAL", "Kutilmagan javob");
      const applied = await applyScan(
        ctx.app,
        { userId: ctx.userId, deviceId: deviceId.data },
        reply.data,
      );
      if (applied === null) return fail("ENV_NO_FOLDER", "Skan natijasi loyihaga mos emas");
      const rows = await ctx.app.db
        .select()
        .from(assets)
        .where(eq(assets.projectId, project.data.id));
      const byStatus = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      }, {});
      return ok({
        status: "done",
        count: applied.count,
        by_status: byStatus,
        problems: rows
          .filter((row) => row.status !== "ok")
          .map((row) => ({ key: row.key, status: row.status, local_path: row.localPath })),
      });
    },
  }),

  defineTool({
    name: "assets_list",
    title: "List project files",
    description:
      "Lists scanned files: key (use as asset:<key> in the spec), kind, status (ok|corrupt|unsupported|missing), resolution, duration. Only status=ok assets can be used.",
    input: z.object({
      project_id: uuidArg("project_id"),
      kind: z.enum(["video", "image", "audio", "other"]).optional(),
      status: z.enum(["ok", "corrupt", "unsupported", "missing"]).optional(),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const filters = [eq(assets.projectId, project.data.id)];
      if (input.kind !== undefined) filters.push(eq(assets.kind, input.kind));
      if (input.status !== undefined) filters.push(eq(assets.status, input.status));
      const rows = await ctx.app.db
        .select()
        .from(assets)
        .where(and(...filters))
        .orderBy(asc(assets.key));
      return ok({ count: rows.length, assets: rows.map(presentAsset) });
    },
  }),

  defineTool({
    name: "asset_preview",
    title: "Preview a file",
    description:
      "Shows you an image or video from the project as small JPEGs: mode=image → one picture (video: frame at 10%); mode=frames → several frames (times in seconds, or count evenly spaced, max 8). Use it to understand media before planning.",
    input: z.object({
      project_id: uuidArg("project_id"),
      key: z.string().min(1).max(128).describe("Asset key from assets_list"),
      mode: z.enum(["image", "frames"]).default("image"),
      times: z.array(z.number().min(0).max(36_000)).min(1).max(8).optional(),
      count: z.number().int().min(1).max(8).optional(),
      max_px: z.number().int().min(128).max(1280).default(768),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async handler(ctx, input) {
      const project = await ownProject(ctx, input.project_id);
      if (!project.ok) return project;
      const [asset] = await ctx.app.db
        .select()
        .from(assets)
        .where(and(eq(assets.projectId, project.data.id), eq(assets.key, input.key)))
        .limit(1);
      if (asset === undefined)
        return fail("SPEC_UNKNOWN_ASSET", `asset:${input.key} yo'q (assets_list)`);
      if (asset.kind !== "image" && asset.kind !== "video") {
        return fail("ASSET_UNSUPPORTED", `Faqat rasm yoki video ko'rsatiladi (${asset.kind})`);
      }
      if (asset.status !== "ok")
        return fail("ASSET_CORRUPT", `asset:${input.key} holati: ${asset.status}`);
      const res = await previewImages(ctx, project.data, asset.localPath, {
        mode: input.mode,
        ...(input.times === undefined ? {} : { times: input.times }),
        ...(input.count === undefined ? {} : { count: input.count }),
        maxPx: input.max_px,
      });
      if (!res.ok) return res;
      return {
        ok: true,
        data: { asset: presentAsset(asset), mode: input.mode, frames: res.data.frames },
        images: res.data.images,
      };
    },
  }),
];
