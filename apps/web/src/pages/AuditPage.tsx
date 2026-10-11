import type { LucideIcon } from "lucide-react";
import { Bot, KeyRound, Monitor, Server, ShieldAlert, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AuditRow } from "../api";
import { Card, CardTitle, Empty, Loading, PageTitle, Segmented, cx, day } from "../ui";

const ACTOR: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  user: { label: "Siz", icon: UserRound, tone: "bg-white text-ink shadow-raise" },
  claude: { label: "Claude", icon: Bot, tone: "bg-peach text-peach-ink" },
  device: { label: "Qurilma", icon: Monitor, tone: "bg-mint text-mint-ink" },
  system: { label: "Tizim", icon: Server, tone: "bg-well text-ink-2" },
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

  const shown = (rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "claude" ? r.actor === "claude" : SECURITY.test(r.action),
  );
  const days = new Map<string, AuditRow[]>();
  for (const row of shown) {
    const label = day(row.ts);
    days.set(label, [...(days.get(label) ?? []), row]);
  }

  return (
    <>
      <PageTitle
        title="Audit"
        muted="jurnali"
        action={<Segmented options={FILTERS} value={filter} onChange={setFilter} />}
      />
      {rows === null ? <Loading /> : null}
      {rows !== null && shown.length === 0 ? (
        <Card>
          <Empty>Hali yozuv yo'q.</Empty>
        </Card>
      ) : null}
      <div className="grid gap-6">
        {[...days.entries()].map(([label, list]) => (
          <Card key={label}>
            <CardTitle>{label}</CardTitle>
            <ol className="tree [--tree-elbow:1.45rem]">
              {list.map((row, i) => {
                const actor = ACTOR[row.actor] ?? ACTOR.system!;
                const alarm = SECURITY.test(row.action) && row.action.includes("reuse");
                const Icon = alarm ? ShieldAlert : actor.icon;
                return (
                  <li key={`${row.ts}-${i}`} className="py-2">
                    <div className="flex items-start gap-3.5">
                      <span
                        className={cx(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.8rem]",
                          alarm ? "bg-stop-soft text-stop" : actor.tone,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 pt-0.5">
                        <div className="text-[0.98rem] font-normal break-words">
                          {describe(row)}
                        </div>
                        <div className="num mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
                          <span>
                            {actor.label} · {new Date(row.ts).toLocaleTimeString("uz-UZ")}
                            {row.ip ? ` · ${row.ip}` : ""}
                          </span>
                          {row.target ? (
                            <span className="flex min-w-0 items-center gap-1">
                              <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                              <span className="truncate">{row.target}</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        ))}
      </div>
    </>
  );
}
