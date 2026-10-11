import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronUp,
  History,
  LogOut,
  Monitor,
  Plug,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "./api";
import type { Device, Me } from "./api";
import { AuditPage } from "./pages/AuditPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { DeviceActivityPage } from "./pages/DeviceActivityPage";
import { DevicePage } from "./pages/DevicePage";
import { DevicesPage } from "./pages/DevicesPage";
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { Count, Logo, Spinner, cx } from "./ui";

interface Child {
  href: string;
  label: string;
  count?: { value: number; tone: "peach" | "mint" | "neutral" };
  dot?: boolean;
}

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  children?: Child[];
  /** Shu bo'limga tegishli yo'llar (faol holat va ochiq daraxt uchun). */
  match: (path: string) => boolean;
}

function page(path: string, me: Me) {
  if (path === "/device") return <DevicePage />;
  if (path.startsWith("/devices/"))
    return <DeviceActivityPage id={path.slice("/devices/".length)} />;
  if (path === "/jobs") return <JobsPage />;
  if (path === "/audit") return <AuditPage />;
  if (path === "/connections") return <ConnectionsPage />;
  if (path === "/profile") return <ProfilePage me={me} />;
  if (path === "/settings") return <SettingsPage />;
  return <DevicesPage />;
}

function nav(devices: Device[] | null): Item[] {
  const live = devices?.filter((d) => d.revoked_at === null) ?? [];
  const online = live.filter((d) => d.online).length;
  const blocked = live.filter((d) => d.job?.state === "BLOCKED").length;
  return [
    {
      href: "/",
      label: "Qurilmalar",
      icon: Monitor,
      match: (p) => p === "/" || p === "/device" || p.startsWith("/devices/"),
      children: [
        {
          href: "/",
          label: "Holat",
          count:
            blocked > 0
              ? { value: blocked, tone: "peach" }
              : online > 0
                ? { value: online, tone: "mint" }
                : undefined,
        },
        ...live
          .slice(0, 4)
          .map((d) => ({ href: `/devices/${d.id}`, label: d.name, dot: d.online })),
        { href: "/device", label: "Qurilma ulash" },
      ],
    },
    { href: "/jobs", label: "Tarix", icon: History, match: (p) => p === "/jobs" },
    { href: "/audit", label: "Audit", icon: ShieldCheck, match: (p) => p === "/audit" },
    {
      href: "/connections",
      label: "Ulangan ilovalar",
      icon: Plug,
      match: (p) => p === "/connections",
    },
    {
      href: "/settings",
      label: "Sozlamalar",
      icon: Settings,
      match: (p) => p === "/settings",
      children: [
        { href: "/settings#elevenlabs", label: "ElevenLabs" },
        { href: "/settings#telegram", label: "Telegram" },
        { href: "/settings#brand", label: "Brand kit" },
      ],
    },
  ];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SideNav({ path, items }: { path: string; items: Item[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <nav aria-label="Asosiy" className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.match(path);
        const expanded = item.children !== undefined && (open[item.href] ?? active);
        const Icon = item.icon;
        return (
          <div key={item.href}>
            <div className="flex items-center">
              <a
                href={item.href}
                aria-current={active && item.children === undefined ? "page" : undefined}
                className={cx(
                  "flex h-12 min-w-0 flex-1 items-center gap-4 rounded-[1rem] px-3 text-[1.05rem] tracking-[-0.01em] no-underline transition-colors duration-200",
                  active ? "font-medium text-ink" : "font-normal text-ink-2 hover:text-ink",
                )}
              >
                <Icon className="h-6 w-6 shrink-0" />
                <span className="truncate">{item.label}</span>
              </a>
              {item.children ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={`${item.label}: ${expanded ? "yopish" : "ochish"}`}
                  onClick={() => setOpen((o) => ({ ...o, [item.href]: !expanded }))}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[0.8rem] text-ink-2 transition-colors hover:bg-well hover:text-ink"
                >
                  {expanded ? (
                    <ChevronUp className="h-5 w-5" />
                  ) : (
                    <ChevronDown className="h-5 w-5" />
                  )}
                </button>
              ) : null}
            </div>
            {expanded && item.children ? (
              <ul className="tree mb-2 ml-[1.5rem] [--tree-elbow:1.6rem]">
                {item.children.map((c) => {
                  const here = c.href.includes("#")
                    ? path + hash === c.href || (hash === "" && c === item.children![0] && active)
                    : path === c.href;
                  return (
                    <li key={c.href} className="py-0.5">
                      <a
                        href={c.href}
                        aria-current={here ? "page" : undefined}
                        className={cx(
                          "flex h-[2.85rem] items-center gap-2 rounded-[1rem] px-4 text-[1rem] tracking-[-0.01em] no-underline transition-[background-color,box-shadow,color] duration-200",
                          here
                            ? "bg-white font-medium text-ink shadow-raise"
                            : "font-normal text-ink-3 hover:text-ink",
                        )}
                      >
                        {c.dot !== undefined ? (
                          <span
                            className={cx(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              c.dot ? "bg-go" : "bg-line",
                            )}
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        {c.count ? <Count tone={c.count.tone}>{c.count.value}</Count> : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function ProfileChip({ me, path, onLogout }: { me: Me; path: string; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <a
        href="/profile"
        aria-current={path === "/profile" ? "page" : undefined}
        className={cx(
          "flex min-w-0 flex-1 items-center gap-3 rounded-[1.1rem] p-2 no-underline transition-[background-color,box-shadow] duration-200",
          path === "/profile" ? "bg-white shadow-raise" : "hover:bg-well",
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-well text-sm font-normal text-ink-2">
          {initials(me.name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.95rem] font-normal text-ink">{me.name}</span>
          <span className="block truncate text-xs text-ink-3">
            {me.telegram_id !== null ? "Telegram orqali" : "Profil"}
          </span>
        </span>
      </a>
      <button
        type="button"
        onClick={onLogout}
        aria-label="Chiqish"
        title="Chiqish"
        className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[0.9rem] text-ink-3 transition-colors hover:bg-well hover:text-ink"
      >
        <LogOut className="h-5 w-5" />
      </button>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const path = window.location.pathname;
  // `/login?next=…`: server (masalan OAuth ruxsat sahifasi) kirishdan keyin shu yo'lga qaytishni so'raydi.
  const loginNext = new URLSearchParams(window.location.search).get("next");
  const next =
    path === "/login"
      ? loginNext !== null && /^\/[^/\\]/.test(loginNext)
        ? loginNext
        : "/"
      : path + window.location.search;

  useEffect(() => {
    void api<Me>("/api/me").then((res) => setMe(res.ok ? res.data : null));
  }, []);

  // Yon paneldagi qurilmalar daraxti (10 s da yangilanadi).
  useEffect(() => {
    if (!me) return;
    const load = async () => {
      const res = await api<Device[]>("/api/devices");
      if (res.ok) setDevices(res.data);
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [me]);

  if (me === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (me === null) return <LoginPage next={next} />;
  if (path === "/login") {
    // Server yo'li (masalan `/oauth/authorize`): to'liq sahifa sifatida ochiladi.
    window.location.replace(next);
    return null;
  }

  const logout = async () => {
    await post("/api/auth/logout");
    window.location.href = "/";
  };
  const items = nav(devices);

  return (
    <div className="min-h-dvh p-2 sm:p-4 lg:p-5">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col rounded-[1.75rem] bg-shell sm:min-h-[calc(100dvh-2rem)] sm:rounded-shell lg:min-h-[calc(100dvh-2.5rem)] lg:flex-row">
        <aside className="hidden w-[19.5rem] shrink-0 flex-col gap-10 self-start px-7 pt-11 pb-7 lg:sticky lg:top-5 lg:flex lg:h-[calc(100dvh-2.5rem)] lg:overflow-y-auto">
          <a href="/" aria-label="AE Studio — bosh sahifa" className="ml-2 w-fit">
            <Logo className="h-[4.5rem] w-[4.5rem]" />
          </a>
          <SideNav path={path} items={items} />
          <div className="mt-auto">
            <ProfileChip me={me} path={path} onLogout={() => void logout()} />
          </div>
        </aside>

        <header className="px-5 pt-6 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <a href="/" aria-label="AE Studio — bosh sahifa">
              <Logo className="h-11 w-11" />
            </a>
            <div className="flex items-center gap-1">
              <a
                href="/profile"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-well text-sm font-normal text-ink-2 no-underline"
                aria-label="Profil"
              >
                {initials(me.name)}
              </a>
              <button
                type="button"
                onClick={() => void logout()}
                aria-label="Chiqish"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[0.9rem] text-ink-3 hover:bg-well hover:text-ink"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
          <nav aria-label="Asosiy" className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {items.map(({ href, label, icon: Icon, match }) => (
              <a
                key={href}
                href={href}
                aria-current={match(path) ? "page" : undefined}
                ref={
                  match(path)
                    ? (el) => el?.scrollIntoView({ inline: "center", block: "nearest" })
                    : undefined
                }
                className={cx(
                  "flex h-10 shrink-0 items-center gap-2 rounded-[0.9rem] px-3.5 text-sm no-underline",
                  match(path)
                    ? "bg-white font-medium text-ink shadow-raise"
                    : "font-normal text-ink-2",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </a>
            ))}
          </nav>
        </header>

        <main className="min-w-0 flex-1 px-5 pt-8 pb-12 sm:px-8 lg:pt-14 lg:pr-12 lg:pb-16 lg:pl-6">
          <div className="mx-auto max-w-[72rem]">{page(path, me)}</div>
        </main>
      </div>
    </div>
  );
}
