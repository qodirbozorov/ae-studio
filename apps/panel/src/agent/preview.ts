/**
 * `asset.preview.request` (§6, MCP `asset_preview` / `frames_capture`): ish papkasidagi rasm yoki videodan
 * kichraytirilgan JPG'lar → pre-signed PUT. Asl fayl cloudga chiqmaydi.
 */
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { makeError, resolveInsideRoot } from "@aes/shared";
import type { ServerMessageOf } from "@aes/shared";
import { FfmpegError, probe, thumbnail } from "./ffmpeg";
import type { Binaries } from "./ffmpeg";
import { uploadFile } from "./files";

export interface PreviewFile {
  storage_key: string;
  time: number | null;
  size: number;
}

/** Kadr vaqtlari: berilgan `times` (davomiylik ichiga siqiladi) yoki `count` ta teng oraliq. */
export function previewTimes(
  mode: "image" | "frames",
  duration: number | null,
  times: number[] | undefined,
  count: number | undefined,
  limit: number,
): (number | null)[] {
  if (duration === null || duration <= 0) return [null];
  const last = Math.max(0, duration - 0.05);
  if (mode === "image") return [Math.min(last, Math.round(duration * 0.1 * 1000) / 1000)];
  const list =
    times !== undefined && times.length > 0
      ? times.map((t) => Math.min(last, t))
      : Array.from({ length: count ?? 4 }, (_, i) => ((i + 0.5) * duration) / (count ?? 4));
  return list.slice(0, limit).map((t) => Math.round(t * 1000) / 1000);
}

export async function makePreviews(
  root: string,
  bins: Binaries,
  message: ServerMessageOf<"asset.preview.request">,
): Promise<PreviewFile[]> {
  const file = resolveInsideRoot(root, message.local_path);
  if (!file.ok) throw new FfmpegError(file.error);
  try {
    await fsp.access(file.data);
  } catch {
    throw new FfmpegError(makeError("ASSET_MISSING", `${message.local_path} topilmadi`));
  }
  const meta = await probe(bins, file.data);
  const duration =
    meta.has_video && meta.duration !== null && meta.duration > 0.2 ? meta.duration : null;
  const times = previewTimes(
    message.mode,
    duration,
    message.times,
    message.count,
    message.uploads.length,
  );
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "aes-prev-"));
  try {
    const out: PreviewFile[] = [];
    for (const [index, time] of times.entries()) {
      const target = message.uploads[index]!;
      const jpg = path.join(tmp, `${index}-${randomBytes(3).toString("hex")}.jpg`);
      await thumbnail(bins, file.data, jpg, {
        ...(time === null ? {} : { at: time }),
        maxPx: message.max_px,
      });
      const uploaded = await uploadFile(target.url, jpg, "image/jpeg");
      out.push({ storage_key: target.storage_key, time, size: uploaded.size });
    }
    return out;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
