/**
 * Server isolation (P8.05): DeepFilterNet3 (`deep-filter` CLI, Rust, PyTorch'siz). Kirish — 48 kHz mono WAV
 * (panel shunday ajratadi), chiqish — WAV. Jarayon past ustuvorlikda, alohida vaqtinchalik papkada.
 * Binar: `DEEP_FILTER_BIN` yoki `apps/server/bin/deep-filter[.exe]` (scripts/fetch-deep-filter.mjs).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setPriority, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DFN_VERSION = "0.5.6";
const TIMEOUT_MS = 15 * 60_000;

export class DeepFilterError extends Error {}

/** `bin/deep-filter` ni yuqoriga qarab qidiradi (tsx'da ham, bundle'da ham). */
export function findDeepFilter(explicit?: string): string | null {
  if (explicit !== undefined && explicit !== "") return existsSync(explicit) ? explicit : null;
  const name = process.platform === "win32" ? "deep-filter.exe" : "deep-filter";
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    for (const candidate of [join(dir, "bin", name), join(dir, "apps", "server", "bin", name)]) {
      if (existsSync(candidate)) return candidate;
    }
    dir = resolve(dir, "..");
  }
  return null;
}

/** RIFF/WAV sarlavhasidan davomiylik (soniya); o'qib bo'lmasa null. */
export function wavDuration(data: Buffer): number | null {
  if (data.length < 44 || data.toString("ascii", 0, 4) !== "RIFF") return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= data.length) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = data.readUInt32LE(offset + 16);
    if (id === "data") return byteRate > 0 ? size / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export interface DeepFilterOptions {
  /** Buyruq: `[binar]` yoki testda `[node, soxta-skript]`. */
  command: string[];
  /** Shovqinni pasaytirish chegarasi (dB); 100 — to'liq. */
  attenLimitDb?: number;
  timeoutMs?: number;
}

export async function runDeepFilter(input: Buffer, options: DeepFilterOptions): Promise<Buffer> {
  const [bin, ...prefix] = options.command;
  if (bin === undefined) throw new DeepFilterError("deep-filter topilmadi");
  const dir = await mkdtemp(join(tmpdir(), "aes-dfn-"));
  try {
    const source = join(dir, "input.wav");
    const out = join(dir, "out");
    await writeFile(source, input);
    const args = [
      ...prefix,
      "-D",
      ...(options.attenLimitDb === undefined ? [] : ["-a", String(options.attenLimitDb)]),
      "-o",
      out,
      source,
    ];
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      if (child.pid !== undefined) {
        try {
          // AE/API bilan CPU'ni bo'lishganda past ustuvorlik.
          setPriority(child.pid, 10);
        } catch {
          // ustuvorlikni o'zgartirib bo'lmasa ham ishlayveradi
        }
      }
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new DeepFilterError("deep-filter vaqti tugadi"));
      }, options.timeoutMs ?? TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new DeepFilterError(`deep-filter ishga tushmadi: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolvePromise();
        else reject(new DeepFilterError(`deep-filter xatosi (${code}): ${stderr.trim()}`));
      });
    });
    return await readFile(join(out, "input.wav"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
