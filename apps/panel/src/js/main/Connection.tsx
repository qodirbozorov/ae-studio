import { useEffect, useState } from "react";
import type { Agent, ConnectionStatus, DeviceCode } from "../../agent";
import { openUrl } from "../lib/cep";

const SERVER_KEY = "aes.server_url";

function savedServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
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
  const [server, setServer] = useState(savedServer);
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
    try {
      localStorage.setItem(SERVER_KEY, server);
    } catch {
      // saqlab bo'lmasa ham davom etamiz
    }
    let pairing: ReturnType<Agent["pair"]>;
    try {
      pairing = agent.pair(server);
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
    if (status === "connected") {
      return (
        <section className="dev conn ok">
          <span className="conn-dot" /> Ulangan: <b>{host}</b>
          <button
            className="ghost right"
            onClick={() => {
              agent.logout();
              setStage({ kind: "form" });
            }}
          >
            Chiqish
          </button>
        </section>
      );
    }
    return (
      <section className="dev conn bad">
        <div>
          <span className="conn-dot" /> {statusText(status)} — <b>{host}</b>
        </div>
        <p className="hint">
          Internet va server manzilini tekshiring. Panel o'zi ham qayta urinadi.
        </p>
        <div className="buttons">
          <button className="primary" onClick={() => agent.connectSaved()}>
            Qayta ulanish
          </button>
          <button
            onClick={() => {
              agent.logout();
              setStage({ kind: "form" });
            }}
          >
            Boshqa serverga
          </button>
        </div>
      </section>
    );
  }

  if (stage.kind === "code") {
    return (
      <section className="dev">
        <h2>Ulanish</h2>
        <p className="hint">Web kabinetda shu kodni tasdiqlang:</p>
        <div className="user-code">{stage.code.user_code}</div>
        <div className="buttons">
          <button onClick={() => openUrl(stage.code.verification_uri_complete)}>
            Brauzerda ochish
          </button>
          <button
            onClick={() => {
              stage.cancel();
              setStage({ kind: "form" });
            }}
          >
            Bekor qilish
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
      <h2>Ulanish</h2>
      <div className="form">
        <input
          value={server}
          onChange={(e) => setServer(e.target.value)}
          placeholder="https://<app>.up.railway.app"
        />
        <div className="buttons">
          <button onClick={start} disabled={server.trim() === ""}>
            Kod olish
          </button>
        </div>
        {stage.error ? <p className="hint error-text">{stage.error}</p> : null}
      </div>
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
