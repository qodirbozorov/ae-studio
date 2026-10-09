/**
 * VERIFY kadrlari (P6.02, update-technicalguidline §5.3):
 * - `waitForFrames` — AE `saveFrameToPng` asinxron yozadi: fayllar diskda (Node) kutiladi, AE bloklanmaydi.
 *   Kadr boshiga 10 s, jami 60 s; bo'lmasa `FRAME_CAPTURE_FAILED { reason: "timeout", missing }`.
 * - `makeContactSheet` — kadrlar bitta grid JPEG'ga (har katak ostida vaqt yozuvi), ffmpeg `xstack`.
 */
import { randomBytes } from "node:crypto";
import { existsSync, promises as fsp, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeError, resolveInsideRoot } from "@aes/shared";
import type { AesError, ServerMessageOf } from "@aes/shared";
import { FfmpegError, probe, run } from "./ffmpeg";
import type { Binaries } from "./ffmpeg";

export const FRAME_WAIT_PER_FRAME_MS = 10_000;
export const FRAME_WAIT_TOTAL_MS = 60_000;

function written(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).size > 0;
  } catch {
    return false;
  }
}

/** Fayllar paydo bo'lishini kutadi (yozilgan, bo'sh emas). Xato bo'lsa AesError. */
export async function waitForFrames(
  root: string,
  files: readonly string[],
  options: {
    perFrameMs?: number;
    totalMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<AesError | null> {
  const perFrame = options.perFrameMs ?? FRAME_WAIT_PER_FRAME_MS;
  const total = Math.min(
    options.totalMs ?? FRAME_WAIT_TOTAL_MS,
    perFrame * Math.max(1, files.length),
  );
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const absolute: string[] = [];
  for (const rel of files) {
    const resolved = resolveInsideRoot(root, rel);
    if (!resolved.ok) return resolved.error;
    absolute.push(resolved.data);
  }
  const started = now();
  for (;;) {
    const missing = files.filter((_, i) => !written(absolute[i]!));
    if (missing.length === 0) return null;
    if (now() - started >= total) {
      return makeError(
        "FRAME_CAPTURE_FAILED",
        `${missing.length}/${files.length} kadr ${Math.round(total / 1000)} s ichida yozilmadi`,
        { reason: "timeout", missing },
      );
    }
    await sleep(100);
  }
}

const FONT_CANDIDATES = [
  "C:/Windows/Fonts/arial.ttf",
  "C:/Windows/Fonts/segoeui.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/Library/Fonts/Arial.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

/** ffmpeg filter qiymatidagi maxsus belgilar (`:` `'` `\` `,`). */
function filterEscape(value: string): string {
  return value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

export function labelFont(): string | null {
  return FONT_CANDIDATES.find((font) => existsSync(font)) ?? null;
}

/** xstack filtergraph: har katak `cell_px` enida, ostida yozuv uchun joy. */
export function sheetFilter(input: {
  count: number;
  cols: number;
  cellW: number;
  cellH: number;
  labels: readonly string[];
  font: string | null;
}): string {
  const labelH = Math.max(18, Math.round(input.cellW * 0.08));
  const chains: string[] = [];
  for (let i = 0; i < input.count; i++) {
    const text = input.labels[i] ?? "";
    const draw =
      input.font === null || text === ""
        ? ""
        : `,drawtext=fontfile='${filterEscape(input.font)}':text='${filterEscape(text)}':` +
          `x=8:y=h-${labelH}+${Math.round(labelH * 0.2)}:fontsize=${Math.round(labelH * 0.62)}:fontcolor=white`;
    chains.push(
      `[${i}:v]scale=${input.cellW}:${input.cellH}:force_original_aspect_ratio=decrease,` +
        `pad=${input.cellW}:${input.cellH + labelH}:(ow-iw)/2:0:color=0x111111${draw}[c${i}]`,
    );
  }
  if (input.count === 1) return `${chains[0]!.replace(/\[c0\]$/, "[out]")}`;
  const layout: string[] = [];
  for (let i = 0; i < input.count; i++) {
    const col = i % input.cols;
    const row = Math.floor(i / input.cols);
    layout.push(`${col * input.cellW}_${row * (input.cellH + labelH)}`);
  }
  const stack =
    Array.from({ length: input.count }, (_, i) => `[c${i}]`).join("") +
    `xstack=inputs=${input.count}:layout=${layout.join("|")}:fill=0x111111[out]`;
  return [...chains, stack].join(";");
}

/** Contact sheet JPEG (vaqtinchalik fayl); chaqiruvchi yuklab, o'chiradi. */
export async function makeContactSheet(
  root: string,
  bins: Binaries,
  message: ServerMessageOf<"frames.sheet.request">,
): Promise<{ file: string; tmp: string }> {
  const inputs: string[] = [];
  for (const rel of message.files) {
    const resolved = resolveInsideRoot(root, rel);
    if (!resolved.ok) throw new FfmpegError(resolved.error);
    if (!written(resolved.data)) {
      throw new FfmpegError(
        makeError("FRAME_CAPTURE_FAILED", `${rel} topilmadi`, { reason: "render_error" }),
      );
    }
    inputs.push(resolved.data);
  }
  const meta = await probe(bins, inputs[0]!);
  const w = meta.width ?? 1080;
  const h = meta.height ?? 1920;
  const cellW = message.cell_px - (message.cell_px % 2);
  const cellH = Math.max(2, Math.round((cellW * h) / w / 2) * 2);
  const filter = sheetFilter({
    count: inputs.length,
    cols: Math.min(message.cols, inputs.length),
    cellW,
    cellH,
    labels: message.labels,
    font: labelFont(),
  });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "aes-sheet-"));
  const out = path.join(tmp, `sheet-${randomBytes(3).toString("hex")}.jpg`);
  const args = ["-y", "-v", "error"];
  for (const file of inputs) args.push("-i", file);
  args.push("-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-q:v", "3", out);
  const res = await run(bins.ffmpeg, args, 60_000);
  if (res.code !== 0 || !written(out)) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw new FfmpegError(
      makeError("FRAME_CAPTURE_FAILED", "Contact sheet yig'ilmadi", {
        reason: "render_error",
        stderr: res.stderr.slice(-400),
      }),
    );
  }
  return { file: out, tmp };
}
