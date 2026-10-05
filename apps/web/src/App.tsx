import { useEffect, useState } from "react";
import { api, post } from "./api";
import type { Me } from "./api";
import { DevicePage } from "./pages/DevicePage";
import { DevicesPage } from "./pages/DevicesPage";
import { LoginPage } from "./pages/LoginPage";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const path = window.location.pathname;
  const next = path + window.location.search;

  useEffect(() => {
    void api<Me>("/api/me").then((res) => setMe(res.ok ? res.data : null));
  }, []);

  if (me === undefined) return <main className="page">Yuklanmoqda…</main>;
  if (me === null) return <LoginPage next={next} />;

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
      {path === "/device" ? <DevicePage /> : <DevicesPage />}
    </main>
  );
}
