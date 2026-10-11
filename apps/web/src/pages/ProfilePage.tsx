import { CalendarDays, ChevronRight, Cpu, Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Device, Me } from "../api";
import {
  Card,
  CardTitle,
  Figure,
  Label,
  Loading,
  Meta,
  OnlineBadge,
  PageTitle,
  Pill,
  when,
} from "../ui";

/** Profil: Telegram hisobi, ro'yxatdan o'tgan sana va qurilmalar (AE versiyasi bilan). */
export function ProfilePage({ me }: { me: Me }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  useEffect(() => {
    void api<Device[]>("/api/devices").then((res) => setDevices(res.ok ? res.data : []));
  }, []);
  const initials = me.name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <PageTitle title={me.name} muted="profili" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card>
          <div className="flex flex-wrap items-center gap-6">
            <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-well text-[1.75rem] font-extralight tracking-[-0.03em] text-ink-2">
              {initials}
            </span>
            <div className="grid min-w-0 gap-2.5">
              <div className="flex flex-wrap gap-2">
                {me.telegram_id !== null ? (
                  <Pill tone="go" icon={Send}>
                    Telegram · ID {me.telegram_id}
                  </Pill>
                ) : (
                  <Pill>Telegram ulanmagan</Pill>
                )}
                {me.email !== null ? <Pill icon={Mail}>{me.email}</Pill> : null}
              </div>
              <Meta icon={CalendarDays}>Ro'yxatdan o'tgan: {when(me.created_at)}</Meta>
            </div>
          </div>
        </Card>
        <Card>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <Label>Qurilmalar</Label>
              <div className="mt-3">
                <Figure value={me.devices} />
              </div>
            </div>
            <div>
              <Label>Onlayn</Label>
              <div className="mt-3 text-go">
                <Figure value={me.online} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle>Qurilmalar</CardTitle>
        {devices === null ? <Loading /> : null}
        <ul className="grid gap-1">
          {devices?.map((d) => (
            <li key={d.id}>
              <a
                href={`/devices/${d.id}`}
                className="-mx-3 flex flex-wrap items-center justify-between gap-3 rounded-[1rem] px-3 py-3 no-underline transition-colors duration-200 hover:bg-well/70"
              >
                <span className="min-w-0 truncate text-[1.05rem] font-normal">{d.name}</span>
                <span className="flex items-center gap-2">
                  <Pill icon={Cpu}>AE {d.ae_version ?? "?"}</Pill>
                  <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
                  <ChevronRight className="h-5 w-5 text-ink-4" />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
