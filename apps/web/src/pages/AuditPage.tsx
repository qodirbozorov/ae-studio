import { Button, Card, Spinner } from "flowbite-react";
import type { LucideIcon } from "lucide-react";
import { Bot, KeyRound, Monitor, Server, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditRow } from "../api";
import { Empty } from "../ui";

const ACTOR: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  user: {
    label: "Siz",
    icon: UserRound,
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  claude: {
    label: "Claude",
    icon: Bot,
    tone: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  },
  device: {
    label: "Qurilma",
    icon: Monitor,
    tone: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  },
  system: {
    label: "Tizim",
    icon: Server,
    tone: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
};

const ACTION: Record<string, string> = {
  "oauth.authorized": "Ilovaga ruxsat berildi",
  "oauth.denied": "Ilova rad etildi",
  "oauth.revoked": "Ilova uzildi",
  "oauth.refresh_reuse": "Eski token qayta ishlatildi — ulanish bekor qilindi",
  "device.approved": "Qurilma ulandi",
  "device.denied": "Qurilma rad etildi",
  "device.revoked": "Qurilma bekor qilindi",
  "brand.saved": "Brand kit saqlandi",
  "elevenlabs.key_set": "ElevenLabs kaliti kiritildi",
  "elevenlabs.key_removed": "ElevenLabs kaliti o'chirildi",
  "telegram.unlinked": "Telegram uzildi",
};

/** Claude vositalari: guruh bo'yicha tushunarli nom. */
function toolLabel(tool: string): string {
  if (tool.startsWith("el_") || tool.startsWith("audio_") || tool.startsWith("transcript_"))
    return `Audio: ${tool}`;
  if (tool.startsWith("plan_") || tool === "spec_schema" || tool === "preflight")
    return `Reja: ${tool}`;
  if (tool.startsWith("verify_") || tool === "contact_sheet" || tool === "frames_capture")
    return `Tekshiruv: ${tool}`;
  if (tool.startsWith("job_") || tool === "build_start") return `Qurish: ${tool}`;
  if (tool.startsWith("ae_") || tool.startsWith("fx_") || tool.startsWith("preset"))
    return `After Effects: ${tool}`;
  return tool;
}

function describe(row: AuditRow): string {
  if (row.action.startsWith("mcp.")) return toolLabel(row.action.slice(4));
  return ACTION[row.action] ?? row.action;
}

const SECURITY = /^(oauth\.|device\.|telegram\.|elevenlabs\.)/;

const FILTERS = [
  { key: "all", label: "Hammasi" },
  { key: "security", label: "Xavfsizlik" },
  { key: "claude", label: "Claude" },
] as const;

/** Audit jurnali: kim, nima, qachon — kunlar bo'yicha guruhlangan. */
export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  useEffect(() => {
    void api<AuditRow[]>("/api/audit").then((res) => setRows(res.ok ? res.data : []));
  }, []);

  if (rows === null) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  const shown = rows.filter((r) =>
    filter === "all" ? true : filter === "claude" ? r.actor === "claude" : SECURITY.test(r.action),
  );
  const days = new Map<string, AuditRow[]>();
  for (const row of shown) {
    const day = new Date(row.ts).toLocaleDateString("uz-UZ", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    days.set(day, [...(days.get(day) ?? []), row]);
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Audit jurnali</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="xs"
              color={filter === f.key ? "blue" : "light"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <Card>
          <Empty>Hali yozuv yo'q.</Empty>
        </Card>
      ) : null}
      {[...days.entries()].map(([day, list]) => (
        <Card key={day} className="mb-4">
          <h2 className="text-sm font-semibold text-gray-500">{day}</h2>
          <ol className="relative ml-3 border-s border-gray-200 dark:border-gray-700">
            {list.map((row, i) => {
              const actor = ACTOR[row.actor] ?? ACTOR.system!;
              const Icon =
                SECURITY.test(row.action) && row.action.includes("reuse")
                  ? ShieldAlert
                  : actor.icon;
              return (
                <li key={`${row.ts}-${i}`} className="ms-6 py-2">
                  <span
                    className={`absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full ${actor.tone}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-medium">{describe(row)}</span>
                    <span className="text-xs text-gray-500">
                      {actor.label} · {new Date(row.ts).toLocaleTimeString("uz-UZ")}
                      {row.ip ? ` · ${row.ip}` : ""}
                    </span>
                  </div>
                  {row.target ? (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <KeyRound className="h-3 w-3" /> {row.target}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
    </section>
  );
}
