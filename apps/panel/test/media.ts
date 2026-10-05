/** Test media: haqiqiy ffmpeg bilan yaratiladi. ffmpeg topilmasa testlar o'tkazib yuboriladi. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveBinaries } from "../src/agent/ffmpeg";
import type { Binaries } from "../src/agent/ffmpeg";

function works(bin: string): boolean {
  return spawnSync(bin, ["-version"], { windowsHide: true }).status === 0;
}

/** PATH, FFMPEG_DIR yoki Windows'dagi user o'rnatmasi. */
export function findFfmpegDir(): string | null | undefined {
  if (process.env.FFMPEG_DIR && works(resolveBinaries(process.env.FFMPEG_DIR).ffmpeg)) {
    return process.env.FFMPEG_DIR;
  }
  if (works("ffmpeg")) return null;
  const local = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "ffmpeg", "bin");
  if (existsSync(local) && works(resolveBinaries(local).ffmpeg)) return local;
  return undefined;
}

const dir = findFfmpegDir();
export const FFMPEG_AVAILABLE = dir !== undefined;
export const bins: Binaries = resolveBinaries(dir ?? null);

function ffmpeg(args: string[]): void {
  const res = spawnSync(bins.ffmpeg, ["-y", "-v", "error", ...args], { windowsHide: true });
  if (res.status !== 0) throw new Error("ffmpeg: " + res.stderr.toString());
}

/** `source/` ichida aralash test fayllari. */
export function makeSourceFolder(root: string): void {
  const source = path.join(root, "source");
  mkdirSync(path.join(source, "b-roll"), { recursive: true });
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1920x1080:rate=30:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    "-c:a",
    "aac",
    "-shortest",
    path.join(source, "Clip 01.mp4"),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=25:duration=1",
    "-c:v",
    "mpeg4",
    "-q:v",
    "5",
    path.join(source, "b-roll", "clip_01.mov"),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=1000x1500",
    "-frames:v",
    "1",
    path.join(source, "Photo.png"),
  ]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:duration=1", path.join(source, "vo.wav")]);
  writeFileSync(path.join(source, "broken.mp4"), Buffer.from("bu video emas"));
  writeFileSync(path.join(source, "notes.txt"), "eslatma");
  writeFileSync(path.join(source, ".hidden.mp4"), "yashirin");
}
