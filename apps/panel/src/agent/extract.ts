/**
 * `audio.extract.request` (§6, P4.04): ish papkasidagi video/audio'dan ovozni ajratadi (mono, siqilgan) va
 * pre-signed PUT bilan storage'ga (`audio-in`) yuklaydi → ElevenLabs (STT, isolation, dubbing …) shu fayldan oladi.
 * Yuklash 3 marta qayta uriniladi (Opus mono ~15 MB/soat — bitta PUT yetarli).
 */
import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeError, resolveInsideRoot } from "@aes/shared";
import type { ServerMessageOf } from "@aes/shared";
import { FfmpegError, probe, run } from "./ffmpeg";
import type { Binaries } from "./ffmpeg";
import { TransferError, uploadFile } from "./files";

const CODECS: Record<"opus" | "wav" | "mp3", { args: string[]; ext: string; mime: string }> = {
  opus: { args: ["-c:a", "libopus", "-b:a", "32k"], ext: "ogg", mime: "audio/ogg" },
  wav: { args: ["-c:a", "pcm_s16le"], ext: "wav", mime: "audio/wav" },
  mp3: { args: ["-c:a", "libmp3lame", "-b:a", "96k"], ext: "mp3", mime: "audio/mpeg" },
};

export interface ExtractResult {
  storage_key: string;
  sha256: string;
  size: number;
  duration_s: number | null;
}

export async function extractAudio(
  root: string,
  bins: Binaries,
  message: ServerMessageOf<"audio.extract.request">,
  attempts = 3,
): Promise<ExtractResult> {
  const source = resolveInsideRoot(root, message.local_path);
  if (!source.ok) throw new FfmpegError(source.error);
  try {
    await fsp.access(source.data);
  } catch {
    throw new FfmpegError(makeError("ASSET_MISSING", `${message.local_path} topilmadi`));
  }
  const meta = await probe(bins, source.data);
  if (!meta.has_audio) {
    throw new FfmpegError(makeError("ASSET_UNSUPPORTED", `${message.local_path} da ovoz yo'q`));
  }
  const codec = CODECS[message.format];
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "aes-ext-"));
  const out = path.join(tmp, `audio-${randomBytes(3).toString("hex")}.${codec.ext}`);
  try {
    const args = ["-y", "-v", "error", "-i", source.data, "-vn"];
    if (message.mono) args.push("-ac", "1");
    if (message.sample_rate !== undefined) args.push("-ar", String(message.sample_rate));
    args.push(...codec.args, out);
    const res = await run(bins.ffmpeg, args, Math.max(120_000, (meta.duration ?? 0) * 2_000));
    if (res.code !== 0) {
      throw new FfmpegError(
        makeError(
          "ASSET_CORRUPT",
          `Ovoz ajratilmadi: ${message.local_path}`,
          res.stderr.slice(-500),
        ),
      );
    }
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const uploaded = await uploadFile(message.upload.url, out, codec.mime);
        return {
          storage_key: message.upload.storage_key,
          sha256: uploaded.sha256,
          size: uploaded.size,
          duration_s: meta.duration,
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof TransferError) throw lastError;
    throw new TransferError(
      makeError(
        "SYS_INTERNAL",
        `Yuklash ${attempts} urinishdan keyin ham bo'lmadi: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      ),
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

/** Kengaytma: storage kaliti uchun (server so'raganda). */
export function extractExt(format: "opus" | "wav" | "mp3"): string {
  return CODECS[format].ext;
}
