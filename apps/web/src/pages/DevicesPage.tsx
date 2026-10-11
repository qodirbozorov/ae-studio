import { Badge, Button, Card, Progress, Spinner } from "flowbite-react";
import { Activity, Clock, Cpu, Folder, Monitor, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "../api";
import type { Device } from "../api";
import { Empty, OnlineBadge, StateBadge, ago } from "../ui";

/** Qurilmalar: holat, AE/panel versiyasi, ochiq papka va joriy job (5 s da yangilanadi). */
export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);

  const load = async () => {
    const res = await api<Device[]>("/api/devices");
    setDevices(res.ok ? res.data : []);
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  const revoke = async (d: Device) => {
    if (
      !window.confirm(`"${d.name}" qurilmasi bekor qilinsinmi? Panel qayta ulanishi kerak bo'ladi.`)
    )
      return;
    await post(`/api/devices/${d.id}/revoke`);
    await load();
  };

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Qurilmalar</h1>
        <Button size="sm" href="/device">
          <Plus className="mr-1 h-4 w-4" /> Qurilma ulash
        </Button>
      </div>
      {devices === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : null}
      {devices?.length === 0 ? (
        <Card>
          <Empty>
            Hali qurilma yo'q. After Effects'da AE Studio panelini oching va ko'rsatilgan kodni{" "}
            <a className="text-blue-600" href="/device">
              shu yerda
            </a>{" "}
            kiriting.
          </Empty>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {devices?.map((d) => (
          <Card key={d.id} className={d.revoked_at ? "opacity-60" : undefined}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                  <Monitor className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                </span>
                <div>
                  <div className="font-semibold">{d.name}</div>
                  <div className="text-xs text-gray-500">{d.os}</div>
                </div>
              </div>
              <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color="purple" icon={Cpu}>
                AE {d.ae_version ?? "?"}
              </Badge>
              {d.panel_version ? <Badge color="gray">Panel {d.panel_version}</Badge> : null}
              {d.ffmpeg === false ? <Badge color="warning">ffmpeg yo'q</Badge> : null}
            </div>
            <div className="grid gap-1 text-sm text-gray-600 dark:text-gray-300">
              {d.project_root ? (
                <div className="flex items-center gap-2 truncate" title={d.project_root}>
                  <Folder className="h-4 w-4 shrink-0" />{" "}
                  <span className="truncate">{d.project_root}</span>
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> Oxirgi aloqa:{" "}
                {d.online ? "hozir" : ago(d.last_seen_at)}
              </div>
            </div>
            {d.job ? (
              <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{d.job.project}</span>
                  <StateBadge state={d.job.state} outcome={d.job.outcome} />
                </div>
                {d.job.progress !== null && d.job.state !== "DONE" ? (
                  <Progress progress={d.job.progress} size="sm" labelProgress={false} />
                ) : null}
                <div className="mt-1 text-xs text-gray-500">{ago(d.job.updated_at)}</div>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button size="xs" color="light" href={`/devices/${d.id}`}>
                <Activity className="mr-1 h-3.5 w-3.5" /> Faollik
              </Button>
              {d.revoked_at === null ? (
                <Button size="xs" color="red" outline onClick={() => revoke(d)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Bekor qilish
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
