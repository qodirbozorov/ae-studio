import { ExternalLink, LogIn, LogOut, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent, ConnectionStatus, DeviceCode, PanelProfile } from "../../agent";
import { openUrl } from "../lib/cep";
import { SERVER_URL } from "../lib/server";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Ulangan hisob: kim, qaysi qurilma, qaysi server; kabinetni ochish va chiqish. */
function Profile({
  agent,
  host,
  onLogout,
  onCabinet,
}: {
  agent: Agent;
  host: string;
  onLogout: () => void;
  onCabinet: () => void;
}) {
  const [profile, setProfile] = useState<PanelProfile | null>(null);
  useEffect(() => {
    let alive = true;
    void agent.profile().then((p) => {
      if (alive) setProfile(p);
    });
    return () => {
      alive = false;
    };
  }, [agent]);
  const name = profile?.name ?? "Ulangan";
  return (
    <section className="dev conn ok" aria-label="Profil">
      <div className="profile">
        <span className="avatar" aria-hidden="true">
          {profile === null ? <span className="conn-dot" /> : initials(name)}
        </span>
        <div className="profile-body">
          <div className="profile-name">{name}</div>
          <div className="profile-meta">
            <span className="conn-dot" />
            <span>
              {profile?.device_name ? `${profile.device_name} · ` : ""}
              {host}
            </span>
          </div>
        </div>
        <div className="profile-actions">
          <button
            className="ghost icon"
            title="Kabinetni ochish"
            aria-label="Kabinetni ochish"
            onClick={onCabinet}
          >
            <ExternalLink size={16} />
          </button>
          <button className="ghost icon" title="Chiqish" aria-label="Chiqish" onClick={onLogout}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Ulanish holatini kuzatadi (agent ulanishni almashtirsa ham). */
export function useConnectionStatus(agent: Agent): ConnectionStatus {
  const [client, setClient] = useState(agent.connection());
  const [status, setStatus] = useState<ConnectionStatus>(client?.status() ?? "idle");
  useEffect(() => {
    const timer = setInterval(() => setClient(agent.connection()), 500);
    return () => clearInterval(timer);
  }, [agent]);
  useEffect(() => {
    if (client === null) {
      setStatus("idle");
      return;
    }
    setStatus(client.status());
    return client.onStatus(setStatus);
  }, [client]);
  return status;
}

type Stage =
  | { kind: "form"; error?: string }
  | { kind: "code"; code: DeviceCode; cancel: () => void }
  | { kind: "account" };

/** "Ulanish" ekrani (§11.1.1): device kod (§4.2) yoki saqlangan hisob. */
export function Connection({ agent, status }: { agent: Agent; status: ConnectionStatus }) {
  const [stage, setStage] = useState<Stage>(() =>
    agent.account() === null ? { kind: "form" } : { kind: "account" },
  );

  // Panel ochilganda saqlangan hisob bilan avtomatik ulanish.
  useEffect(() => {
    if (agent.account() !== null && agent.connection() === null) agent.connectSaved();
  }, [agent]);

  // Internet qaytganda yoki panel oynasi faollashganda — darhol qayta ulanish (backoff kutmasdan).
  useEffect(() => {
    const retry = () => {
      if (agent.account() !== null && agent.connection()?.status() !== "connected")
        agent.connectSaved();
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [agent]);

  // Server qurilmani rad etsa (kabinetda bekor qilingan) — formaga qaytish.
  useEffect(() => {
    if (status === "unauthorized" && agent.account() === null) {
      setStage({ kind: "form", error: "Qurilma bekor qilingan. Qaytadan ulang." });
    }
  }, [status, agent]);

  const start = () => {
    let pairing: ReturnType<Agent["pair"]>;
    try {
      pairing = agent.pair(SERVER_URL);
    } catch (error) {
      setStage({ kind: "form", error: error instanceof Error ? error.message : String(error) });
      return;
    }
    pairing.code.then(
      (code) => {
        setStage({ kind: "code", code, cancel: pairing.cancel });
        openUrl(code.verification_uri_complete);
      },
      (error: unknown) =>
        setStage({ kind: "form", error: error instanceof Error ? error.message : String(error) }),
    );
    pairing.done.then(
      () => setStage({ kind: "account" }),
      (error: unknown) =>
        setStage({ kind: "form", error: error instanceof Error ? error.message : String(error) }),
    );
  };

  if (stage.kind === "account") {
    const account = agent.account();
    const host = account?.server_url.replace(/^https?:\/\//, "") ?? "";
    // Ulangan bo'lsa ixcham qator; aks holda holat va "Qayta ulanish".
    if (status === "connected" && account !== null) {
      return (
        <Profile
          agent={agent}
          host={host}
          onLogout={() => {
            agent.logout();
            setStage({ kind: "form" });
          }}
          onCabinet={() => openUrl(account.server_url)}
        />
      );
    }
    return (
      <section className="dev conn bad">
        <div>
          <span className="conn-dot" /> {statusText(status)} — <b>{host}</b>
        </div>
        <p className="hint">Internetni tekshiring. Panel o'zi ham qayta urinadi.</p>
        <div className="buttons">
          <button className="primary" onClick={() => agent.connectSaved()}>
            <RefreshCw size={15} /> Qayta ulanish
          </button>
          <button
            onClick={() => {
              agent.logout();
              setStage({ kind: "form" });
            }}
          >
            <LogOut size={15} /> Chiqish
          </button>
        </div>
      </section>
    );
  }

  if (stage.kind === "code") {
    return (
      <section className="dev">
        <h2>Kirish</h2>
        <p className="hint">Brauzerda kabinet ochildi — shu kodni tasdiqlang:</p>
        <div className="user-code">{stage.code.user_code}</div>
        <div className="buttons">
          <button onClick={() => openUrl(stage.code.verification_uri_complete)}>
            <ExternalLink size={15} /> Brauzerda ochish
          </button>
          <button
            onClick={() => {
              stage.cancel();
              setStage({ kind: "form" });
            }}
          >
            <X size={15} /> Bekor qilish
          </button>
        </div>
        <p className="hint">
          Tasdiq kutilmoqda… (kod {Math.round(stage.code.expires_in / 60)} daqiqa amal qiladi)
        </p>
      </section>
    );
  }

  return (
    <section className="dev">
      <h2>Kirish</h2>
      <p className="hint">
        AE Studio kabinetiga ulaning: brauzerda kabinet ochiladi, Telegram orqali kirib, panel
        ko'rsatgan kodni tasdiqlaysiz.
      </p>
      <div className="buttons">
        <button className="primary" onClick={start}>
          <LogIn size={15} /> Kirish
        </button>
      </div>
      {stage.error ? <p className="hint error-text">{stage.error}</p> : null}
    </section>
  );
}

function statusText(status: ConnectionStatus): string {
  switch (status) {
    case "connected":
      return "ulangan";
    case "connecting":
      return "ulanmoqda…";
    case "disconnected":
      return "aloqa yo'q, qayta ulanmoqda";
    case "unauthorized":
      return "rad etildi";
    default:
      return "ulanmagan";
  }
}
