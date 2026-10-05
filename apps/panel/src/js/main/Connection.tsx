import { useEffect, useState } from "react";
import pkg from "../../../package.json";
import type { Agent, ConnectionStatus } from "../../agent";
import { nodeRequire } from "../lib/cep";

const STORAGE_KEY = "aes.dev.connection";

interface Saved {
  url: string;
  token: string;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return JSON.parse(raw) as Saved;
  } catch {
    // localStorage bo'lmasligi mumkin
  }
  return { url: "ws://localhost:3000/ws/agent", token: "" };
}

function deviceInfo(): { name: string; os: string } {
  const os = nodeRequire<{ hostname(): string; platform(): string; release(): string }>("os");
  if (os === null) return { name: "browser", os: navigator.platform };
  return { name: os.hostname(), os: `${os.platform()} ${os.release()}` };
}

export function useConnectionStatus(agent: Agent): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(agent.connection()?.status() ?? "idle");
  const [client, setClient] = useState(agent.connection());
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

/** Faza 1 dev ulanishi: server URL + DEV_AGENT_TOKEN (P2.04 da device kod bilan almashtiriladi). */
export function Connection({ agent, status }: { agent: Agent; status: ConnectionStatus }) {
  const [saved, setSaved] = useState<Saved>(load);

  const connect = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // saqlab bo'lmasa ham ulanaveramiz
    }
    agent.connect({ ...saved, device: deviceInfo(), panelVersion: pkg.version });
  };

  return (
    <section className="dev">
      <h2>Server (dev)</h2>
      <div className="form">
        <input
          value={saved.url}
          onChange={(e) => setSaved({ ...saved, url: e.target.value })}
          placeholder="wss://<app>.up.railway.app/ws/agent"
        />
        <input
          type="password"
          value={saved.token}
          onChange={(e) => setSaved({ ...saved, token: e.target.value })}
          placeholder="DEV_AGENT_TOKEN"
        />
        <div className="buttons">
          <button onClick={connect}>Ulanish</button>
          <button onClick={() => agent.disconnect()} disabled={status === "idle"}>
            Uzish
          </button>
        </div>
      </div>
    </section>
  );
}
