import { Badge, Button, Spinner } from "flowbite-react";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  History,
  LogOut,
  Monitor,
  Plug,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "./api";
import type { Me } from "./api";
import { AuditPage } from "./pages/AuditPage";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { DeviceActivityPage } from "./pages/DeviceActivityPage";
import { DevicePage } from "./pages/DevicePage";
import { DevicesPage } from "./pages/DevicesPage";
import { JobsPage } from "./pages/JobsPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Qurilmalar", icon: Monitor },
  { href: "/jobs", label: "Tarix", icon: History },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
  { href: "/connections", label: "Ulangan ilovalar", icon: Plug },
  { href: "/profile", label: "Profil", icon: UserRound },
  { href: "/settings", label: "Sozlamalar", icon: Settings },
];

function active(path: string, href: string): boolean {
  return href === "/" ? path === "/" || path.startsWith("/devices/") : path.startsWith(href);
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

/** Eski sahifalar `.legacy` klasslari bilan (styles.css). */
const LEGACY = new Set(["/device", "/jobs", "/settings"]);

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
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

  if (me === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (me === null) {
    return (
      <div className="legacy">
        <LoginPage next={next} />
      </div>
    );
  }
  if (path === "/login") {
    // Server yo'li (masalan `/oauth/authorize`): to'liq sahifa sifatida ochiladi.
    window.location.replace(next);
    return null;
  }

  const logout = async () => {
    await post("/api/auth/logout");
    window.location.href = "/";
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <a
            href="/"
            className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Clapperboard className="h-4 w-4" />
            </span>
            AE Studio
          </a>
          <div className="ml-auto flex items-center gap-3">
            <a href="/profile" className="flex items-center gap-2 text-sm">
              <span className="hidden font-medium sm:inline">{me.name}</span>
              {me.telegram_id !== null ? (
                <Badge color="info" icon={Send}>
                  Telegram
                </Badge>
              ) : null}
            </a>
            <Button size="xs" color="light" onClick={logout}>
              <LogOut className="mr-1 h-3.5 w-3.5" /> Chiqish
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <nav className="sticky top-20 flex flex-col gap-1">
            {NAV.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  active(path, href)
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
              </a>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {NAV.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                  active(path, href)
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-300"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </a>
            ))}
          </nav>
          <div className={LEGACY.has(path) ? "legacy" : undefined}>{page(path, me)}</div>
        </main>
      </div>
    </div>
  );
}
