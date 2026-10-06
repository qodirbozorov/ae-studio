/**
 * ffmpeg/ffprobe o'rami (§1 agent): `child_process.spawn` + timeout + kill (§2.3).
 * Binarlar: sozlamadagi papka yoki PATH (P5.10 da ZXP ichiga qo'shiladi).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeError } from "@aes/shared";
import type { AesError } from "@aes/shared";

export const PROBE_TIMEOUT_MS = 30_000;
export const THUMB_TIMEOUT_MS = 60_000;
export const THUMB_MAX_PX = 1280;

export class FfmpegError extends Error {
  constructor(readonly error: AesError) {
    super(error.message ?? error.code);
    this.name = "FfmpegError";
  }
}

export interface Binaries {
  ffmpeg: string;
  ffprobe: string;
}

/** Platforma tegi: ZXP ichidagi `bin/<platform>-<arch>/` papkasi (P5.10). */
export function platformTag(): string {
  return `${process.platform}-${process.arch}`;
}

/** ZXP bilan kelgan ffmpeg papkasi (agent `agent/agent.cjs` dan `../bin/<tag>`); bo'lmasa null. */
export function bundledFfmpegDir(base: string = __dirname): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  const dir = path.resolve(base, "..", "bin", platformTag());
  return existsSync(path.join(dir, `ffmpeg${exe}`)) && existsSync(path.join(dir, `ffprobe${exe}`))
    ? dir
    : null;
}

/** Sozlamadagi papka → ZXP ichidagi binarlar → PATH. */
export function resolveBinaries(
  dir: string | null | undefined,
  bundled: string | null = bundledFfmpegDir(),
): Binaries {
  const exe = process.platform === "win32" ? ".exe" : "";
  if (dir === null || dir === undefined || dir === "") {
    if (bundled !== null) {
      return {
        ffmpeg: path.join(bundled, `ffmpeg${exe}`),
        ffprobe: path.join(bundled, `ffprobe${exe}`),
      };
    }
    return { ffmpeg: "ffmpeg", ffprobe: "ffprobe" };
  }
  return { ffmpeg: path.join(dir, `ffmpeg${exe}`), ffprobe: path.join(dir, `ffprobe${exe}`) };
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Jarayonni ishga tushiradi; timeout'da o'ldiradi. Binar topilmasa `ENV_FFMPEG_MISSING`. */
export function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new FfmpegError(makeError("AE_TIMEOUT", `${path.basename(bin)}: ${timeoutMs} ms`)));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new FfmpegError(
          error.code === "ENOENT"
            ? makeError("ENV_FFMPEG_MISSING", `${bin} topilmadi`)
            : makeError("SYS_INTERNAL", error.message),
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

export interface MediaMeta {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  has_video: boolean;
  has_audio: boolean;
  video_codec: string | null;
  audio_codec: string | null;
  sample_rate: number | null;
  channels: number | null;
  format: string | null;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
}

function parseRate(rate: string | undefined): number | null {
  if (rate === undefined) return null;
  const [num, den] = rate.split("/").map(Number);
  if (num === undefined || !Number.isFinite(num) || num <= 0) return null;
  const value = den === undefined || den === 0 ? num : num / den;
  return Math.round(value * 1000) / 1000;
}

/** ffprobe → metadata. O'qib bo'lmasa `ASSET_CORRUPT`. */
export async function probe(bins: Binaries, file: string): Promise<MediaMeta> {
  const res = await run(
    bins.ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    PROBE_TIMEOUT_MS,
  );
  let data: { format?: { duration?: string; format_name?: string }; streams?: ProbeStream[] };
  try {
    data = JSON.parse(res.stdout) as typeof data;
  } catch {
    data = {};
  }
  const streams = data.streams ?? [];
  if (res.code !== 0 || streams.length === 0) {
    throw new FfmpegError(
      makeError(
        "ASSET_CORRUPT",
        `ffprobe o'qiy olmadi: ${path.basename(file)}`,
        res.stderr.slice(0, 300),
      ),
    );
  }
  const video = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseRate(video?.avg_frame_rate),
    has_video: video !== undefined,
    has_audio: audio !== undefined,
    video_codec: video?.codec_name ?? null,
    audio_codec: audio?.codec_name ?? null,
    sample_rate: audio?.sample_rate !== undefined ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    format: data.format?.format_name ?? null,
  };
}

/** Rasm yoki videodan JPG thumbnail (≤ maxPx, nisbat saqlanadi). Video uchun `at` soniyadagi kadr. */
export async function thumbnail(
  bins: Binaries,
  file: string,
  out: string,
  options: { at?: number; maxPx?: number } = {},
): Promise<void> {
  const max = options.maxPx ?? THUMB_MAX_PX;
  const args = ["-y", "-v", "error"];
  if (options.at !== undefined && options.at > 0) args.push("-ss", options.at.toFixed(3));
  args.push(
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`,
    "-q:v",
    "3",
    out,
  );
  const res = await run(bins.ffmpeg, args, THUMB_TIMEOUT_MS);
  if (res.code !== 0) {
    throw new FfmpegError(
      makeError(
        "ASSET_CORRUPT",
        `Thumbnail yaratilmadi: ${path.basename(file)}`,
        res.stderr.slice(0, 300),
      ),
    );
  }
}

/** ffmpeg va ffprobe ishga tushadimi (env_check uchun, 5 s). */
export async function checkBinaries(bins: Binaries): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([
      run(bins.ffmpeg, ["-version"], 5_000),
      run(bins.ffprobe, ["-version"], 5_000),
    ]);
    return a.code === 0 && b.code === 0;
  } catch {
    return false;
  }
}
