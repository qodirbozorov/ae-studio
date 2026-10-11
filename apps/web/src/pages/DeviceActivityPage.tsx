import { ArrowLeft, Cpu, FileVideo, Folder, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { DeviceActivity } from "../api";
import {
  Card,
  CardTitle,
  Empty,
  IconWell,
  LevelIcon,
  LinkButton,
  Loading,
  OnlineBadge,
  PageTitle,
  Pill,
  Segmented,
  StateBadge,
  ago,
  eventTitle,
  when,
} from "../ui";

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

  if (data === undefined) return <Loading />;
  if (data === null)
    return (
      <Card>
        <Empty>Qurilma topilmadi.</Empty>
      </Card>
    );
  const d = data.device;
  const events = data.events.filter((e) =>
    filter === "all" ? true : filter === "error" ? e.level === "error" : e.level !== "info",
  );

  return (
    <>
      <LinkButton size="sm" variant="ghost" href="/" className="-ml-3 mb-4">
        <ArrowLeft /> Qurilmalar
      </LinkButton>
      <PageTitle title={d.name} muted="faolligi" />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-6">
          <IconWell icon={Monitor} size="lg" />
          <div className="min-w-0 flex-1 basis-56">
            <div className="text-[1.6rem] leading-tight font-normal tracking-[-0.025em]">
              {d.os}
            </div>
            <div className="mt-1 text-[0.95rem] text-ink-3">Ulangan: {when(d.created_at)}</div>
          </div>
          <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
        </div>
        <div className="mt-8 flex flex-wrap gap-2">
          <Pill icon={Cpu}>AE {d.ae_version ?? "?"}</Pill>
          {d.panel_version ? <Pill>Panel {d.panel_version}</Pill> : null}
          {d.project_root ? (
            <Pill icon={Folder} title={d.project_root}>
              {d.project_root}
            </Pill>
          ) : null}
          {d.project_path ? (
            <Pill icon={FileVideo} title={d.project_path}>
              {d.project_path.split(/[\\/]/).pop()}
            </Pill>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <Card>
          <CardTitle>Oxirgi job'lar</CardTitle>
          {data.jobs.length === 0 ? <Empty>Hali job yo'q.</Empty> : null}
          <ul className="grid gap-1">
            {data.jobs.map((j) => (
              <li
                key={j.id}
                className="-mx-3 flex items-center justify-between gap-3 rounded-[1rem] px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[1rem] font-normal">{j.project}</div>
                  <div className="text-sm text-ink-3">{ago(j.created_at)}</div>
                </div>
                <StateBadge state={j.state} outcome={j.outcome} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle aside={<Segmented options={FILTERS} value={filter} onChange={setFilter} />}>
            Amallar lentasi
          </CardTitle>
          {events.length === 0 ? <Empty>Hodisa yo'q.</Empty> : null}
          <ol className="tree max-h-[62vh] overflow-y-auto pr-2 [--tree-elbow:1.25rem]">
            {events.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="py-2.5">
                <div className="flex gap-3">
                  <span className="mt-[0.2rem]">
                    <LevelIcon level={e.level} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[0.98rem] font-normal">{eventTitle(e.type)}</span>
                      <span className="num text-xs text-ink-3">
                        {e.project} · {new Date(e.ts).toLocaleTimeString("uz-UZ")}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm break-words text-ink-3">{e.message}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
