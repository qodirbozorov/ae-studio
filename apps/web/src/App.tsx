import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  History,
  LogOut,
  Monitor,
  Plug,
  RefreshCw,
  Settings,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { useInstall, useOnline } from "./pwa";
import { Button, Count, Logo, Pill, Spinner, cx } from "./ui";

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
        { href: "/settings#balance", label: "Balans va Pro" },
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

function MobileHeader({
  me,
  path,
  items,
  onLogout,
  onInstall,
}: {
  me: Me;
  path: string;
  items: Item[];
  onLogout: () => void;
  onInstall: (() => Promise<void>) | null;
}) {
  const strip = useRef<HTMLElement>(null);
  const [stuck, setStuck] = useState(false);

  // Faol tab ko'rinadigan joyga — faqat tab qatori suriladi, sahifa emas.
  useLayoutEffect(() => {
    const el = strip.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
  }, [path]);

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-20 rounded-t-[1.75rem] bg-shell pt-5 transition-shadow duration-200 sm:rounded-t-shell lg:hidden",
        stuck && "rounded-t-none shadow-[0_10px_20px_-16px_rgb(0_0_0/0.25)] sm:rounded-t-none",
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 sm:px-8">
        <a href="/" aria-label="AE Studio — bosh sahifa">
          <Logo className="h-10" />
        </a>
        <div className="flex items-center gap-1">
          {onInstall ? (
            <button
              type="button"
              onClick={() => void onInstall()}
              aria-label="Ilovani o'rnatish"
              title="Ilovani o'rnatish"
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[0.9rem] text-ink-2 hover:bg-well hover:text-ink"
            >
              <Download className="h-5 w-5" />
            </button>
          ) : null}
          <a
            href="/profile"
            aria-label="Profil"
            aria-current={path === "/profile" ? "page" : undefined}
            className={cx(
              "flex h-11 w-11 items-center justify-center rounded-full text-sm font-normal no-underline",
              path === "/profile" ? "bg-white text-ink shadow-raise" : "bg-well text-ink-2",
            )}
          >
            {initials(me.name)}
          </a>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Chiqish"
            title="Chiqish"
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[0.9rem] text-ink-3 hover:bg-well hover:text-ink"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
      <nav
        ref={strip}
        aria-label="Asosiy"
        className="fade-x mt-4 flex gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {items.map(({ href, label, icon: Icon, match }) => (
          <a
            key={href}
            href={href}
            aria-current={match(path) ? "page" : undefined}
            className={cx(
              "flex h-11 shrink-0 items-center gap-2 rounded-[0.9rem] px-4 text-[0.95rem] no-underline transition-[background-color,box-shadow,color] duration-200",
              match(path) ? "bg-white font-medium text-ink shadow-raise" : "font-normal text-ink-2",
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

/** Server bilan aloqa yo'q (oflayn PWA yoki tarmoq xatosi). */
function Offline() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-[34rem] rounded-[2rem] bg-shell px-7 py-10 sm:rounded-shell sm:px-12 sm:py-14">
        <Logo className="h-12" />
        <h1 className="mt-10 text-[2.25rem] leading-[1.05] font-light tracking-[-0.035em] text-balance sm:text-[3rem]">
          Aloqa <span className="text-[#858585]">yo'q</span>
        </h1>
        <p className="mt-5 max-w-[42ch] text-[1.05rem] leading-relaxed text-ink-2">
          Server bilan bog'lanib bo'lmadi. Internetni tekshirib, qaytadan urinib ko'ring.
        </p>
        <Button className="mt-8" onClick={() => window.location.reload()}>
          <RefreshCw /> Qayta urinish
        </Button>
      </div>
    </main>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | "offline" | undefined>(undefined);
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
    void api<Me>("/api/me").then((res) =>
      setMe(res.ok ? res.data : res.error.code === "SYS_INTERNAL" ? "offline" : null),
    );
  }, []);
  const online = useOnline();
  const install = useInstall();

  // Yon paneldagi qurilmalar daraxti (10 s da yangilanadi).
  useEffect(() => {
    if (!me || me === "offline") return;
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
  if (me === "offline") return <Offline />;
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
    <div className="min-h-dvh p-2 sm:p-3 lg:p-4">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col rounded-[1.75rem] bg-shell sm:min-h-[calc(100dvh-2rem)] sm:rounded-shell lg:min-h-[calc(100dvh-2.5rem)] lg:flex-row">
        <aside className="hidden w-[17.5rem] shrink-0 flex-col gap-8 self-start px-6 pt-9 pb-6 lg:sticky lg:top-5 lg:flex lg:h-[calc(100dvh-2.5rem)] lg:overflow-y-auto">
          <a href="/" aria-label="AE Studio — bosh sahifa" className="ml-3 w-fit">
            <Logo className="h-14" />
          </a>
          <SideNav path={path} items={items} />
          <div className="mt-auto grid gap-3">
            {install ? (
              <Button
                variant="secondary"
                size="sm"
                className="justify-start"
                onClick={() => void install()}
              >
                <Download /> Ilovani o'rnatish
              </Button>
            ) : null}
            <ProfileChip me={me} path={path} onLogout={() => void logout()} />
          </div>
        </aside>

        <MobileHeader
          me={me}
          path={path}
          items={items}
          onLogout={() => void logout()}
          onInstall={install}
        />

        <main className="min-w-0 flex-1 px-5 pt-8 pb-12 sm:px-8 lg:pt-10 lg:pr-10 lg:pb-12 lg:pl-6">
          <div className="mx-auto max-w-[72rem]">{page(path, me)}</div>
        </main>
        {online ? null : (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
            <Pill tone="wait" icon={WifiOff}>
              Internet yo'q — ma'lumotlar yangilanmayapti
            </Pill>
          </div>
        )}
      </div>
    </div>
  );
}
