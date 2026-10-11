import { Activity, Clock, Cpu, Folder, Monitor, Plus, Trash2, Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "../api";
import type { Device } from "../api";
import {
  Button,
  Card,
  Empty,
  Figure,
  IconWell,
  Label,
  LinkButton,
  Loading,
  Meta,
  OnlineBadge,
  PageTitle,
  Pill,
  StateBadge,
  ago,
  cx,
} from "../ui";

function DeviceCard({ d, onRevoke }: { d: Device; onRevoke: (d: Device) => void }) {
  const job = d.job;
  const running = job !== null && job.state !== "DONE";
  return (
    <Card className={cx("flex flex-col", d.revoked_at !== null && "opacity-60")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-[1.6rem] leading-tight font-normal tracking-[-0.025em]">
            {d.name}
          </h2>
          <div className="mt-1 text-[0.95rem] text-ink-3">{d.os}</div>
        </div>
        <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
      </div>

      <div className="mt-8 mb-10">
        <IconWell icon={Monitor} size="lg" />
      </div>

      <Label icon={Clapperboard}>{job ? job.project : "Joriy job"}</Label>
      <div className="mt-3 mb-5">
        {job && running && job.progress !== null ? (
          <Figure value={Math.round(job.progress)} suffix="%" />
        ) : job ? (
          <div className="text-[2.5rem] leading-none font-extralight tracking-[-0.04em]">
            {job.state === "DONE" ? "Yakunlandi" : "Jarayonda"}
          </div>
        ) : (
          <div className="text-[2.5rem] leading-none font-extralight tracking-[-0.04em] text-ink-4">
            Bo'sh
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {job ? <StateBadge state={job.state} outcome={job.outcome} /> : null}
        <span className="text-[0.95rem] text-ink-3">
          {job ? ago(job.updated_at) : d.online ? "yangi job kutilmoqda" : "panel ulanmagan"}
        </span>
      </div>
      {running && job.progress !== null ? (
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-well" aria-hidden="true">
          <div
            className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
          />
        </div>
      ) : null}

      <div className="mt-8 grid gap-2.5 border-t border-hair pt-6">
        <div className="flex flex-wrap gap-2">
          <Pill icon={Cpu}>AE {d.ae_version ?? "?"}</Pill>
          {d.panel_version ? <Pill>Panel {d.panel_version}</Pill> : null}
          {d.ffmpeg === false ? <Pill tone="wait">ffmpeg yo'q</Pill> : null}
        </div>
        {d.project_root ? (
          <Meta icon={Folder} title={d.project_root}>
            {d.project_root}
          </Meta>
        ) : null}
        <Meta icon={Clock}>Oxirgi aloqa: {d.online ? "hozir" : ago(d.last_seen_at)}</Meta>
      </div>

      <div className="mt-7 flex flex-wrap gap-2">
        <LinkButton size="sm" href={`/devices/${d.id}`}>
          <Activity /> Faollik
        </LinkButton>
        {d.revoked_at === null ? (
          <Button size="sm" variant="danger" onClick={() => onRevoke(d)}>
            <Trash2 /> Bekor qilish
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

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
    <>
      <PageTitle
        title="Qurilmalar"
        muted="holati"
        action={
          <LinkButton variant="primary" href="/device">
            <Plus /> Qurilma ulash
          </LinkButton>
        }
      />
      {devices === null ? <Loading /> : null}
      {devices?.length === 0 ? (
        <Card>
          <Empty>
            Hali qurilma yo'q. After Effects'da AE Studio panelini oching va ko'rsatilgan kodni{" "}
            <a className="text-ink underline" href="/device">
              shu yerda
            </a>{" "}
            kiriting.
          </Empty>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {devices?.map((d) => (
          <DeviceCard key={d.id} d={d} onRevoke={(x) => void revoke(x)} />
        ))}
      </div>
    </>
  );
}
