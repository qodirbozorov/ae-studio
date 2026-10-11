/**
 * Log yozuvini tushunarli ko'rinishga keltiradi: op nomlari o'zbekcha, xato kodlari tavsifi bilan,
 * emoji o'rniga turi (ikonka va rang UI'da).
 */
import { ERROR_DEFS } from "@aes/shared";
import type { LogEntry } from "../../agent";

export type LogKind = "running" | "done" | "error" | "warn" | "info";

export interface LogView {
  kind: LogKind;
  title: string;
  detail?: string;
  code?: string;
}

const OPS: Record<string, string> = {
  "project.open_or_create": "Loyihani ochish",
  "project.save": "Loyihani saqlash",
  "item.import": "Fayl import",
  "comp.create": "Kompozitsiya yaratish",
  "comp.nest": "Sahnani joylash",
  "layer.add_media": "Media qatlam",
  "layer.add_text": "Matn qatlami",
  "layer.add_shape": "Shakl qatlami",
  "layer.add_audio": "Audio qatlam",
  "layer.add_solid": "Solid/null qatlam",
  "layer.set": "Qatlam sozlamalari",
  "layer.mask": "Maska",
  "prop.keyframes": "Animatsiya kalitlari",
  "prop.expression": "Expression",
  "fx.add": "Effekt",
  "fx.apply_preset": "Preset",
  "captions.build": "Subtitrlar",
  "audio.duck": "Musiqa pasaytirish",
  "template.instantiate": "Shablon",
  "frames.capture": "Kadrlar olish",
  "render.queue": "Render",
  "jsx.run": "Skript",
  ping: "AE bilan aloqa",
  info: "AE ma'lumoti",
  undo: "Bekor qilish",
  "fx.catalog": "Effektlar ro'yxati",
  "fx.params": "Effekt parametrlari",
  "layer.inspect": "Tekshiruv",
  "presets.list": "Presetlar ro'yxati",
  "preset.inspect": "Preset tekshiruvi",
};

function opName(op: string): string {
  return OPS[op] ?? op;
}

function hint(code: string): string | undefined {
  const def = (ERROR_DEFS as Record<string, { hint: string } | undefined>)[code];
  return def?.hint;
}

export function describeLog(entry: LogEntry): LogView {
  const text = entry.message.trim();
  // ⏳ op (op_id) | ⏳ sahna: N op
  let m = /^⏳\s+(\S+)\s+\((.+)\)$/.exec(text);
  if (m) return { kind: "running", title: `${opName(m[1]!)} bajarilmoqda…` };
  m = /^⏳\s+(.+):\s+(\d+) op$/.exec(text);
  if (m) return { kind: "running", title: `«${m[1]}» sahnasi qurilmoqda (${m[2]} amal)` };
  // ✅ op N ms (avvaldan bor) | ✅ sahna: N op N ms
  m = /^✅\s+(.+):\s+(\d+) op (\d+) ms$/.exec(text);
  if (m)
    return { kind: "done", title: `«${m[1]}» sahnasi tayyor`, detail: `${m[2]} amal · ${m[3]} ms` };
  m = /^✅\s+(\S+)\s+(\d+) ms(.*)$/.exec(text);
  if (m) {
    return {
      kind: "done",
      title: `${opName(m[1]!)} — tayyor`,
      detail: `${m[2]} ms${m[3]!.includes("avvaldan") ? " · avvaldan bor edi" : ""}`,
    };
  }
  // ❌ op — CODE: xabar
  m = /^❌\s+(\S+)\s+—\s+([A-Z][A-Z0-9_]+)(?::\s*(.*))?$/.exec(text);
  if (m) {
    const code = m[2]!;
    const message = m[3]?.trim();
    const help = hint(code);
    return {
      kind: "error",
      title: `${opName(m[1]!)}: ${message !== undefined && message !== "" ? message : "xato"}`,
      ...(help === undefined ? {} : { detail: help }),
      code,
    };
  }
  const clean = text.replace(/^(?:\p{Extended_Pictographic}|\u{FE0F}|\u{200D})+\s*/u, "");
  const kind: LogKind =
    entry.level === "error"
      ? "error"
      : entry.level === "warn"
        ? "warn"
        : text.startsWith("✅") || text.startsWith("🟢")
          ? "done"
          : "info";
  return { kind, title: clean };
}
