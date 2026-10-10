/**
 * RENDER (P3.07, Q5): `.aep` → aerender (AE UI bloklanmaydi) yoki zaxira Render Queue → oraliq fayl →
 * ffmpeg (preset) → `out/<nom>_vNNN.mp4`. Mavjud fayl ustiga yozilmaydi (`_2`, `_3` …). Oraliq papka o'chiriladi.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import { RENDER_PRESETS, makeError, makeOp, resolveInsideRoot } from "@aes/shared";
import type { AesError, ServerMessageOf } from "@aes/shared";
import type { AeBridge } from "./ae-bridge";
import { FfmpegError, probe, run } from "./ffmpeg";
import type { Binaries } from "./ffmpeg";
import type { LogStore } from "./log";

export class RenderError extends Error {
  constructor(readonly error: AesError) {
    super(error.message ?? error.code);
    this.name = "RenderError";
  }
}

const fail = (message: string, details?: unknown): never => {
  throw new RenderError(makeError("RENDER_FAILED", message, details));
};

export interface RenderDeps {
  root: string;
  bins: Binaries;
  bridge: AeBridge;
  log: LogStore;
  /** Sozlamadagi aerender yo'li (yoki null). */
  aerenderPath: string | null;
  /** AE o'rnatilgan papka (`Folder.appPackage`), aerender'ni topish uchun. */
  appPath: string | null;
  omTemplate: string | null;
}

export interface RenderResult {
  out: string;
  duration: number;
  size: number;
  method: "aerender" | "render_queue";
  encoder: string;
}

/** aerender: sozlama → AE papkasi (Windows: `<app>/aerender.exe`, macOS: `.app` yonida `aerender`). */
export function findAerender(aerenderPath: string | null, appPath: string | null): string | null {
  const candidates: string[] = [];
  if (aerenderPath !== null) candidates.push(aerenderPath);
  if (appPath !== null) {
    if (process.platform === "win32") candidates.push(path.join(appPath, "aerender.exe"));
    else
      candidates.push(path.join(path.dirname(appPath), "aerender"), path.join(appPath, "aerender"));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** `out/x.mp4` band bo'lsa `out/x_2.mp4`, … (hech narsa ustiga yozilmaydi). */
export function uniquePath(base: string, ext: string): string {
  let candidate = `${base}${ext}`;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}_${n}${ext}`;
  return candidate;
}

const H264_ENCODERS = ["libx264", "h264_mf", "libopenh264", "h264_videotoolbox", "h264_nvenc"];
const encoderCache = new Map<string, string>();

/** Mavjud H.264 encoder (LGPL build'da libx264 bo'lmasligi mumkin); hech biri bo'lmasa mpeg4. */
export async function pickEncoder(bins: Binaries): Promise<string> {
  const cached = encoderCache.get(bins.ffmpeg);
  if (cached !== undefined) return cached;
  const res = await run(bins.ffmpeg, ["-hide_banner", "-encoders"], 15_000);
  const available = new Set(
    res.stdout
      .split(/\r?\n/)
      .map((line) => /^\s*V\S*\s+(\S+)/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  const chosen = H264_ENCODERS.find((name) => available.has(name)) ?? "mpeg4";
  encoderCache.set(bins.ffmpeg, chosen);
  return chosen;
}

function runAerender(
  bin: string,
  args: string[],
  timeoutMs: number,
  log: LogStore,
): Promise<string> {
  // `.js`/`.mjs` — o'rab oluvchi skript (testlar va maxsus sozlamalar uchun) Node bilan ishga tushadi.
  const script = /\.(c|m)?js$/i.test(bin);
  const command = script ? process.execPath : bin;
  const fullArgs = script ? [bin, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(command, fullArgs, { windowsHide: true });
    let output = "";
    let lastPercent = -10;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new RenderError(makeError("AE_TIMEOUT", `aerender ${Math.round(timeoutMs / 1000)} s`)),
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-8000);
      const percent = /PROGRESS:.*?\((\d+)\)/.exec(text);
      if (percent !== null) {
        const value = Number(percent[1]);
        if (value - lastPercent >= 10) {
          lastPercent = value;
          log.add({ level: "info", message: `🎬 Render: ${value}%` });
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new RenderError(makeError("RENDER_FAILED", `aerender ishga tushmadi: ${error.message}`)),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else
        reject(
          new RenderError(makeError("RENDER_FAILED", `aerender kodi ${code}`, output.slice(-1500))),
        );
    });
  });
}

async function largestFile(dir: string): Promise<string | null> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  let best: { file: string; size: number } | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    const { size } = await fsp.stat(file);
    if (size > 0 && (best === null || size > best.size)) best = { file, size };
  }
  return best?.file ?? null;
}

export async function renderJob(
  deps: RenderDeps,
  message: ServerMessageOf<"render.request">,
): Promise<RenderResult> {
  const project = resolveInsideRoot(deps.root, message.project_path);
  if (!project.ok) throw new RenderError(project.error);
  if (!fs.existsSync(project.data)) {
    throw new RenderError(makeError("ASSET_MISSING", `${message.project_path} topilmadi`));
  }
  const outBase = resolveInsideRoot(deps.root, message.out_base);
  if (!outBase.ok) throw new RenderError(outBase.error);
  const preset = RENDER_PRESETS[message.preset];
  const id = randomBytes(4).toString("hex");
  const tmpRel = `out/.render-${id}`;
  const tmp = path.join(deps.root, tmpRel);
  await fsp.mkdir(tmp, { recursive: true });
  const renderTimeout = Math.max(10 * 60_000, message.duration * 120_000);
  try {
    // 1. AE → oraliq fayl
    const aerender = findAerender(deps.aerenderPath, deps.appPath);
    let method: RenderResult["method"];
    const renderQueue = async () => {
      const res = await deps.bridge.runOp(
        makeOp(
          "render.queue",
          `render.rq.${id}`,
          0,
          { comp: message.comp.op_id, preset: message.preset, out: `${tmpRel}/render.mov` },
          { timeout_ms: Math.min(3_600_000, renderTimeout) },
        ),
        { root: deps.root },
      );
      if (!res.ok) throw new RenderError(res.error);
    };
    let aerenderOutput = "";
    if (aerender !== null) {
      method = "aerender";
      deps.log.add({ level: "info", message: `🎬 aerender: ${message.comp.name}` });
      const args = [
        "-project",
        project.data,
        "-comp",
        message.comp.name,
        "-output",
        path.join(tmp, "render.mov"),
      ];
      if (deps.omTemplate !== null) args.push("-OMtemplate", deps.omTemplate);
      aerenderOutput = await runAerender(aerender, args, renderTimeout, deps.log);
    } else {
      method = "render_queue";
      deps.log.add({
        level: "warn",
        message: "aerender topilmadi — AE Render Queue (UI band bo'ladi)",
      });
      await renderQueue();
    }
    const intermediate = await largestFile(tmp);
    // aerender 0 kodi bilan tugab, fayl yozmasligi mumkin (comp topilmadi, OM shabloni …): sababi
    // xatoga qo'shiladi. Qayta render (AE Render Queue) avtomatik qilinmaydi — kompyuterni band qiladi.
    const aerenderError = /^.*ERROR.*$/im.exec(aerenderOutput)?.[0]?.trim().slice(0, 300) ?? null;
    if (intermediate === null) {
      fail(
        `AE render fayl yaratmadi${aerenderError === null ? "" : ` (aerender: ${aerenderError})`}`,
        { aerender: aerenderOutput.slice(-1500) },
      );
    }

    // 2. ffmpeg → preset mp4 (ustiga yozmaslik: -n va noyob nom)
    const encoder = await pickEncoder(deps.bins);
    const out = uniquePath(outBase.data, ".mp4");
    await fsp.mkdir(path.dirname(out), { recursive: true });
    const res = await run(
      deps.bins.ffmpeg,
      [
        "-n",
        "-v",
        "error",
        "-i",
        intermediate!,
        "-c:v",
        encoder,
        "-b:v",
        preset.video_bitrate,
        "-pix_fmt",
        "yuv420p",
        "-r",
        String(message.fps),
        "-c:a",
        "aac",
        "-b:a",
        preset.audio_bitrate,
        "-movflags",
        "+faststart",
        out,
      ],
      Math.max(10 * 60_000, message.duration * 30_000),
    );
    if (res.code !== 0) fail(`ffmpeg (${encoder}) xato`, res.stderr.slice(-1500));

    // 3. Natija
    let duration = 0;
    try {
      duration = (await probe(deps.bins, out)).duration ?? 0;
    } catch (error) {
      if (error instanceof FfmpegError) fail("Render fayli o'qilmadi", error.error);
      throw error;
    }
    const { size } = await fsp.stat(out);
    const rel = path.relative(deps.root, out).replace(/\\/g, "/");
    deps.log.add({ level: "info", message: `✅ Render: ${rel} (${duration.toFixed(2)} s)` });
    return { out: rel, duration, size, method, encoder };
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
