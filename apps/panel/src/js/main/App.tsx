import { useEffect, useState } from "react";
import pkg from "../../../package.json";
import { getAgent } from "../lib/agent";
import { hostEnvironment, isCep, panelBackground } from "../lib/cep";
import { Connection, useConnectionStatus } from "./Connection";
import { DevTools } from "./DevTools";
import { LiveLog } from "./LiveLog";
import { Settings, Workspace } from "./Workspace";

type Status = "ok" | "off" | "unknown";

function Dot({ status }: { status: Status }) {
  const symbol = status === "ok" ? "🟢" : status === "off" ? "🔴" : "⚪";
  return <span aria-label={status}>{symbol}</span>;
}

const SERVER_DOT: Record<string, Status> = { connected: "ok", disconnected: "off" };

function ServerStatus({ agent }: { agent: NonNullable<ReturnType<typeof getAgent>> }) {
  const status = useConnectionStatus(agent);
  return (
    <div>
      <Dot status={SERVER_DOT[status] ?? "unknown"} /> Server
    </div>
  );
}

export function App() {
  const [background, setBackground] = useState<string | null>(null);
  const host = hostEnvironment();
  const agent = getAgent();

  useEffect(() => {
    setBackground(panelBackground());
  }, []);

  return (
    <main className="app" style={background ? { backgroundColor: background } : undefined}>
      <header className="header">
        <h1>AE Studio</h1>
        <span className="version">v{pkg.version}</span>
      </header>

      <section className="status">
        {agent === null ? (
          <div>
            <Dot status="unknown" /> Server
          </div>
        ) : (
          <ServerStatus agent={agent} />
        )}
        <div>
          <Dot status={isCep() ? "ok" : "off"} /> AE {host ? host.appVersion : "(CEP tashqarisida)"}
        </div>
        <div>
          <Dot status="unknown" /> Claude
        </div>
        <div>
          <Dot status="unknown" /> ElevenLabs
        </div>
      </section>

      {agent === null ? (
        <p className="hint">Agent yuklanmadi: panel After Effects ichida ochilishi kerak.</p>
      ) : (
        <>
          <ConnectionPanel agent={agent} />
        </>
      )}
    </main>
  );
}

function ConnectionPanel({ agent }: { agent: NonNullable<ReturnType<typeof getAgent>> }) {
  const status = useConnectionStatus(agent);
  const [logLevel, setLogLevel] = useState(agent.settings().log_level);
  return (
    <>
      <Connection agent={agent} status={status} />
      <Workspace agent={agent} connected={status === "connected"} />
      <DevTools agent={agent} />
      <Settings agent={agent} onChange={(s) => setLogLevel(s.log_level)} />
      <LiveLog store={agent.log} minLevel={logLevel} />
    </>
  );
}
