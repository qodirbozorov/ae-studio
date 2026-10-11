import { Avatar, Badge, Card, Spinner } from "flowbite-react";
import { CalendarDays, Cpu, Mail, Monitor, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Device, Me } from "../api";
import { OnlineBadge, when } from "../ui";

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
    <section className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar placeholderInitials={initials} rounded size="lg" />
          <div className="grid gap-1">
            <div className="text-xl font-semibold">{me.name}</div>
            <div className="flex flex-wrap gap-2">
              {me.telegram_id !== null ? (
                <Badge color="info" icon={Send}>
                  Telegram · ID {me.telegram_id}
                </Badge>
              ) : (
                <Badge color="gray">Telegram ulanmagan</Badge>
              )}
              {me.email !== null ? (
                <Badge color="gray" icon={Mail}>
                  {me.email}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <CalendarDays className="h-4 w-4" /> Ro'yxatdan o'tgan: {when(me.created_at)}
            </div>
          </div>
          <div className="ml-auto grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800">
              <div className="text-2xl font-semibold">{me.devices}</div>
              <div className="text-xs text-gray-500">qurilma</div>
            </div>
            <div className="rounded-lg bg-green-50 px-4 py-2 dark:bg-green-500/10">
              <div className="text-2xl font-semibold text-green-700 dark:text-green-400">
                {me.online}
              </div>
              <div className="text-xs text-gray-500">onlayn</div>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <h2 className="font-semibold">Qurilmalar</h2>
        {devices === null ? <Spinner size="sm" /> : null}
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {devices?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <a
                href={`/devices/${d.id}`}
                className="flex items-center gap-2 font-medium hover:underline"
              >
                <Monitor className="h-4 w-4 text-gray-500" /> {d.name}
              </a>
              <div className="flex items-center gap-2">
                <Badge color="purple" icon={Cpu}>
                  AE {d.ae_version ?? "?"}
                </Badge>
                <OnlineBadge online={d.online} revoked={d.revoked_at !== null} />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
