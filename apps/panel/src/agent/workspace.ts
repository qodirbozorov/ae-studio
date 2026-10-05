/**
 * Ish papkasi (§1, §11.1.2): `/source /audio /frames /out /logs /.aestudio` va panel sozlamalari.
 */
import fs from "node:fs";
import path from "node:path";

export const PROJECT_FOLDERS = ["source", "audio", "frames", "out", "logs", ".aestudio"] as const;

export interface ProjectInfo {
  id: string;
  name: string;
  root_path: string;
  device_id: string | null;
  created_at: string;
}

/** Papka mavjud va katalog ekanini tekshiradi, kerakli ichki papkalarni yaratadi. Root `/` bilan. */
export function prepareProjectFolder(root: string): string {
  const resolved = path.resolve(root);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) {
    throw new Error(`Papka topilmadi: ${root}`);
  }
  for (const folder of PROJECT_FOLDERS)
    fs.mkdirSync(path.join(resolved, folder), { recursive: true });
  return resolved.replace(/\\/g, "/");
}

export type LogLevelSetting = "debug" | "info" | "warn" | "error";

export interface PanelSettings {
  device_name: string | null;
  log_level: LogLevelSetting;
  /** ffmpeg/ffprobe papkasi; null — PATH (P5.10 da ZXP ichidagi binarlar). */
  ffmpeg_dir: string | null;
}

const DEFAULT_SETTINGS: PanelSettings = { device_name: null, log_level: "info", ffmpeg_dir: null };

function settingsPath(dataDir: string): string {
  return path.join(dataDir, ".aestudio", "settings.json");
}

export function loadSettings(dataDir: string): PanelSettings {
  try {
    const raw = JSON.parse(
      fs.readFileSync(settingsPath(dataDir), "utf8"),
    ) as Partial<PanelSettings>;
    return {
      device_name:
        typeof raw.device_name === "string" && raw.device_name.trim() !== ""
          ? raw.device_name.trim().slice(0, 100)
          : null,
      log_level: ["debug", "info", "warn", "error"].includes(raw.log_level as string)
        ? (raw.log_level as LogLevelSetting)
        : "info",
      ffmpeg_dir:
        typeof raw.ffmpeg_dir === "string" && raw.ffmpeg_dir !== "" ? raw.ffmpeg_dir : null,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(dataDir: string, settings: PanelSettings): void {
  const file = settingsPath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}
