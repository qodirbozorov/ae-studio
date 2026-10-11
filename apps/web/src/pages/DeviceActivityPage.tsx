import { Badge, Button, Card, Spinner } from "flowbite-react";
import { ArrowLeft, Cpu, Folder, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { DeviceActivity } from "../api";
import { Empty, LevelIcon, OnlineBadge, StateBadge, ago, eventTitle, when } from "../ui";

const FILTERS = [
  { key: "all", label: "Hammasi" },
  { key: "warn", label: "Ogohlantirish" },
  { key: "error", label: "Xatolar" },
] as const;

/** Bitta qurilma: jonli holat, oxirgi job'lar va hodisalar lentasi (3 s da yangilanadi). */
export function DeviceActivityPage({ id }: { id: string }) {
  const [data, setData] = useState<DeviceActivity | null | undefined>(undefined);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  useEffect(() => {
    const load = async () => {
      const res = await api<DeviceActivity>(`/api/devices/${id}/activity`);
      setData(res.ok ? res.data : null);
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [id]);

  if (data === undefined) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (data === null) return <Empty>Qurilma topilmadi.</Empty>;
  const d = data.device;
  const events = data.events.filter((e) =>
    filter === "all" ? true : filter === "error" ? e.level === "error" : e.level !== "info",
  );

  return (
    <section className="grid gap-4">
      <Button size="xs" color="light" href="/" className="w-fit">
        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Qurilmalar
      </Button>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Monitor className="h-6 w-6 text-gray-500" />
            <div>
              <div className="text-lg font-semibold">{d.name}</div>
              <div className="text-xs text-gray-500">
                {d.os} · ulangan: {when(d.created_at)}
              </div>
            </div>
          </div>
          <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge color="purple" icon={Cpu}>
            AE {d.ae_version ?? "?"}
          </Badge>
          {d.panel_version ? <Badge color="gray">Panel {d.panel_version}</Badge> : null}
          {d.project_root ? (
            <Badge color="gray" icon={Folder}>
              {d.project_root}
            </Badge>
          ) : null}
          {d.project_path ? (
            <Badge color="gray">{d.project_path.split(/[\\/]/).pop()}</Badge>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <h2 className="font-semibold">Oxirgi job'lar</h2>
          {data.jobs.length === 0 ? <Empty>Hali job yo'q.</Empty> : null}
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{j.project}</div>
                  <div className="text-xs text-gray-500">{ago(j.created_at)}</div>
                </div>
                <StateBadge state={j.state} outcome={j.outcome} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Amallar lentasi</h2>
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
          {events.length === 0 ? <Empty>Hodisa yo'q.</Empty> : null}
          <ol className="max-h-[60vh] overflow-y-auto pr-1">
            {events.map((e, i) => (
              <li
                key={`${e.ts}-${i}`}
                className="flex gap-3 border-b border-gray-100 py-2 last:border-0 dark:border-gray-800"
              >
                <LevelIcon level={e.level} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{eventTitle(e.type)}</span>
                    <span className="text-xs text-gray-500">
                      {e.project} · {new Date(e.ts).toLocaleTimeString("uz-UZ")}
                    </span>
                  </div>
                  <div className="break-words text-gray-600 dark:text-gray-300">{e.message}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </section>
  );
}
