/** Admin panel (`/admin`): kirish va bo'limlar. Hozircha Storage; foydalanuvchilar, tariflar, musiqa — Faza 9. */
import { HardDrive, LogIn, LogOut, Music, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, post } from "../api";
import { Button, Field, Logo, Notice, Spinner, cx, inputClass } from "../ui";
import { MusicPage } from "./MusicPage";
import { StoragePage } from "./StoragePage";

const NAV = [
  { href: "/admin/storage", label: "Storage", icon: HardDrive },
  { href: "/admin/music", label: "Musiqa", icon: Music },
] as const;

function AdminLogin({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post("/api/admin/login", { login, password });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-[30rem] rounded-[2rem] bg-shell px-7 py-10 sm:rounded-shell sm:px-12 sm:py-14">
        <Logo className="h-12" />
        <h1 className="mt-10 text-[2.25rem] leading-[1.05] font-light tracking-[-0.035em] sm:text-[3rem]">
          Admin <span className="text-[#858585]">panel</span>
        </h1>
        <form onSubmit={(e) => void submit(e)} className="surface mt-10 grid gap-4 p-7 sm:p-9">
          <Field label="Login" htmlFor="admin-login">
            <input
              id="admin-login"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          <Field label="Parol" htmlFor="admin-password">
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
            />
          </Field>
          {error !== null ? <Notice ok={false}>{error}</Notice> : null}
          <div>
            <Button type="submit" disabled={busy}>
              <LogIn /> {busy ? "Kirilmoqda…" : "Kirish"}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

export function AdminApp() {
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");
  const [login, setLogin] = useState("");
  const path = window.location.pathname;

  const check = async () => {
    const res = await api<{ login: string }>("/api/admin/me");
    if (res.ok) {
      setLogin(res.data.login);
      setState("ready");
    } else {
      setState("login");
    }
  };

  useEffect(() => {
    void check();
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (state === "login") return <AdminLogin onDone={() => void check()} />;

  const logout = async () => {
    await post("/api/admin/logout");
    setState("login");
  };

  return (
    <div className="min-h-dvh p-2 sm:p-4 lg:p-5">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col rounded-[1.75rem] bg-shell sm:min-h-[calc(100dvh-2rem)] sm:rounded-shell lg:min-h-[calc(100dvh-2.5rem)] lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-8 px-6 pt-8 pb-4 lg:w-[17rem] lg:px-7 lg:pt-11 lg:pb-7">
          <div className="flex items-center justify-between gap-3">
            <a href="/admin" aria-label="Admin — bosh sahifa" className="ml-1">
              <Logo className="h-11" />
            </a>
            <span className="flex items-center gap-1.5 rounded-[0.7rem] bg-ink px-2.5 py-1 text-xs font-normal text-white">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </span>
          </div>
          <nav aria-label="Admin" className="flex gap-1 lg:flex-col">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active =
                path === href ||
                (href === "/admin/storage" && (path === "/admin" || path === "/admin/"));
              return (
                <a
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex h-11 items-center gap-3 rounded-[1rem] px-3.5 text-[1rem] no-underline transition-[background-color,box-shadow,color] duration-200",
                    active
                      ? "bg-white font-medium text-ink shadow-raise"
                      : "font-normal text-ink-2 hover:text-ink",
                  )}
                >
                  <Icon className="h-5 w-5" /> {label}
                </a>
              );
            })}
          </nav>
          <div className="mt-auto hidden items-center justify-between gap-2 lg:flex">
            <span className="truncate text-sm text-ink-3">{login}</span>
            <Button size="sm" variant="ghost" onClick={() => void logout()}>
              <LogOut /> Chiqish
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-5 pt-4 pb-12 sm:px-8 lg:pt-14 lg:pr-12 lg:pb-16 lg:pl-4">
          <div className="mx-auto max-w-[72rem]">
            {path.startsWith("/admin/music") ? <MusicPage /> : <StoragePage />}
          </div>
        </main>
      </div>
    </div>
  );
}
