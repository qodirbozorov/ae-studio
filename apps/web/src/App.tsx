import { useEffect, useState } from "react";
import { api, post } from "./api";
import type { Me } from "./api";
import { ConnectionsPage } from "./pages/ConnectionsPage";
import { DevicePage } from "./pages/DevicePage";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

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

  if (me === undefined) return <main className="page">Yuklanmoqda…</main>;
  if (me === null) return <LoginPage next={next} />;
  if (path === "/login") {
    // Server yo'li (masalan `/oauth/authorize`): to'liq sahifa sifatida ochiladi.
    window.location.replace(next);
    return <main className="page">Yo'naltirilmoqda…</main>;
  }

  const logout = async () => {
    await post("/api/auth/logout");
    window.location.href = "/";
  };

  return (
    <main className="page">
      <header className="top">
        <a href="/" className="brand">
          AE Studio
        </a>
        <span className="muted">{me.email}</span>
        <button className="link" onClick={logout}>
          Chiqish
        </button>
      </header>
      <nav className="tabs">
        <a href="/" className={path === "/" ? "active" : undefined}>
          Qurilmalar
        </a>
        <a href="/connections" className={path === "/connections" ? "active" : undefined}>
          Ulangan ilovalar
        </a>
        <a href="/settings" className={path === "/settings" ? "active" : undefined}>
          Sozlamalar
        </a>
      </nav>
      {path === "/device" ? (
        <DevicePage />
      ) : path === "/connections" ? (
        <ConnectionsPage />
      ) : path === "/settings" ? (
        <SettingsPage />
      ) : (
        <DevicesPage />
      )}
    </main>
  );
}
