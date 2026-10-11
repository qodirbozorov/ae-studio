/** Kabinet uchun umumiy UI bo'laklari: vaqt, holat nishonlari, hodisa nomlari. */
import { Badge } from "flowbite-react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import type { ReactNode } from "react";

export function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("uz-UZ") : "—";
}

/** "3 daqiqa oldin" ko'rinishi. */
export function ago(value: string | null | undefined): string {
  if (!value) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return "hozirgina";
  if (s < 3600) return `${Math.floor(s / 60)} daqiqa oldin`;
  if (s < 86_400) return `${Math.floor(s / 3600)} soat oldin`;
  return `${Math.floor(s / 86_400)} kun oldin`;
}

const STATE: Record<string, { label: string; color: string }> = {
  CHECK: { label: "Tekshiruv", color: "info" },
  PLAN: { label: "Reja", color: "info" },
  INGEST: { label: "Fayllar", color: "info" },
  AUDIO: { label: "Audio", color: "purple" },
  PREFLIGHT: { label: "Tayyorlov", color: "info" },
  BUILD: { label: "Qurilmoqda", color: "indigo" },
  VERIFY: { label: "Tekshiruvda", color: "warning" },
  RENDER: { label: "Render", color: "purple" },
  REPORT: { label: "Hisobot", color: "info" },
  DONE: { label: "Tayyor", color: "success" },
  BLOCKED: { label: "To'xtagan", color: "failure" },
  WAITING_AGENT: { label: "Panel kutilmoqda", color: "warning" },
};

export function StateBadge({ state, outcome }: { state: string; outcome?: string | null }) {
  if (state === "DONE" && outcome === "cancelled") return <Badge color="gray">Bekor qilindi</Badge>;
  if (state === "DONE" && outcome === "failed") return <Badge color="failure">Xato</Badge>;
  const s = STATE[state] ?? { label: state, color: "gray" };
  return <Badge color={s.color}>{s.label}</Badge>;
}

export function OnlineBadge({ online, revoked }: { online: boolean; revoked?: boolean }) {
  if (revoked) return <Badge color="failure">Bekor qilingan</Badge>;
  return online ? (
    <Badge color="success">
      <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
      Onlayn
    </Badge>
  ) : (
    <Badge color="gray">Oflayn</Badge>
  );
}

const LEVEL: Record<string, { icon: LucideIcon; tone: string }> = {
  info: { icon: CircleCheck, tone: "text-blue-600 dark:text-blue-400" },
  warn: { icon: CircleAlert, tone: "text-amber-500" },
  error: { icon: CircleX, tone: "text-red-600 dark:text-red-400" },
  debug: { icon: Info, tone: "text-gray-400" },
};

export function LevelIcon({ level }: { level: string }) {
  const l = LEVEL[level] ?? LEVEL.info!;
  const Icon = l.icon;
  return <Icon className={`h-4 w-4 shrink-0 ${l.tone}`} />;
}

/** Job hodisasi turi → tushunarli sarlavha. */
const EVENT: Record<string, string> = {
  "job.created": "Job yaratildi",
  "job.state": "Holat o'zgardi",
  "job.blocked": "To'xtadi",
  "job.patched": "Reja yangilandi",
  "check.env": "Muhit tekshirildi",
  "check.folder_restored": "Ish papkasi tiklandi",
  "plan.ok": "Reja qabul qilindi",
  "ingest.done": "Fayllar o'qildi",
  "preflight.ok": "Qurishga tayyor",
  "preflight.warning": "Ogohlantirish",
  "build.resume": "Qurish davom etdi",
  "build.done": "Qurish tugadi",
  "scene.done": "Sahna qurildi",
  "op.failed": "Amal bajarilmadi",
  "op.undone": "Amal bekor qilindi",
  "script.result": "Skript",
  "verify.waiting": "Tekshiruv kutilmoqda",
  "verify.approved": "Tasdiqlandi",
  "verify.contact_sheet": "Kadrlar ko'rildi",
  "verify.frames": "Kadrlar olindi",
  "verify.reason": "Tuzatish sababi",
  "render.started": "Render boshlandi",
  "render.done": "Render tugadi",
  "render.failed": "Render xatosi",
  "agent.waiting": "Panel kutilmoqda",
  "agent.back": "Panel qayta ulandi",
  "audio.ready": "Audio tayyor",
  "audio.skipped": "Audio yo'q",
  "file.copy_failed": "Fayl yuborilmadi",
};

export function eventTitle(type: string): string {
  return EVENT[type] ?? type;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">{children}</p>;
}
