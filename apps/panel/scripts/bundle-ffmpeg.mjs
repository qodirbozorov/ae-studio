#!/usr/bin/env node
/**
 * ZXP uchun ffmpeg/ffprobe (P5.10, Q9): binarlarni `src/bin/<platform>-<arch>/` ga ko'chiradi
 * (cep.config `copyAssets` → `dist/cep/bin/...`). Agent ularni sozlamada yo'l berilmasa ishlatadi.
 *
 * Manba: `AES_FFMPEG_DIR` (ffmpeg va ffprobe bor papka) yoki PATH'dagi ffmpeg.
 * Litsenziya: faqat LGPL build (`--enable-gpl` / `--enable-nonfree` bo'lsa to'xtaydi; `AES_ALLOW_GPL=1` — ataylab).
 * macOS uchun shu skript Mac'da ishga tushiriladi (👤): har platforma o'z papkasiga.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const panelDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? ".exe" : "";
const tag = `${process.platform}-${process.arch}`;

function findSourceDir() {
  if (process.env.AES_FFMPEG_DIR) return process.env.AES_FFMPEG_DIR;
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const found = execFileSync(cmd, ["ffmpeg"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    return found === "" ? null : path.dirname(found);
  } catch {
    return null;
  }
}

export function licenseOf(versionText) {
  const gpl = /--enable-gpl\b/.test(versionText);
  const nonfree = /--enable-nonfree\b/.test(versionText);
  return { gpl, nonfree, lgpl: !gpl && !nonfree };
}

function main() {
  const source = findSourceDir();
  if (source === null) {
    console.error("ffmpeg topilmadi: AES_FFMPEG_DIR ni bering yoki ffmpeg'ni PATH'ga qo'shing");
    process.exit(1);
  }
  const ffmpeg = path.join(source, `ffmpeg${exe}`);
  const ffprobe = path.join(source, `ffprobe${exe}`);
  for (const file of [ffmpeg, ffprobe]) {
    if (!existsSync(file)) {
      console.error(`Topilmadi: ${file}`);
      process.exit(1);
    }
  }
  const version = execFileSync(ffmpeg, ["-version"], { encoding: "utf8" });
  const license = licenseOf(version);
  if (!license.lgpl && process.env.AES_ALLOW_GPL !== "1") {
    console.error(
      `ffmpeg build ${license.nonfree ? "nonfree" : "GPL"}: tarqatish uchun LGPL build kerak (Q9). ` +
        "Ataylab bo'lsa AES_ALLOW_GPL=1.",
    );
    process.exit(1);
  }
  const dest = path.join(panelDir, "src", "bin", tag);
  mkdirSync(dest, { recursive: true });
  for (const file of [ffmpeg, ffprobe]) {
    const target = path.join(dest, path.basename(file));
    copyFileSync(file, target);
    if (process.platform !== "win32") chmodSync(target, 0o755);
  }
  writeFileSync(path.join(dest, "VERSION.txt"), version);
  writeFileSync(
    path.join(dest, "LICENSE.txt"),
    [
      "FFmpeg (https://ffmpeg.org) — LGPL v2.1+ build, o'zgartirilmagan holda tarqatiladi.",
      "Manba kodi: https://ffmpeg.org/download.html (versiya — VERSION.txt).",
      "FFmpeg is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later.",
      license.lgpl ? "" : "DIQQAT: bu build LGPL emas (AES_ALLOW_GPL=1 bilan qo'shilgan).",
    ].join("\n"),
  );
  console.log(
    `ffmpeg/ffprobe → ${path.relative(panelDir, dest)} (${license.lgpl ? "LGPL" : "GPL"})`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
