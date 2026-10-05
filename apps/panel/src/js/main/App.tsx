import { useEffect, useState, useSyncExternalStore } from "react";
import { claudeIndicator } from "../../agent/claude";
import pkg from "../../../package.json";
import { getAgent } from "../lib/agent";
import { hostEnvironment, isCep, panelBackground } from "../lib/cep";
import { Connection, useConnectionStatus } from "./Connection";
import { Audio } from "./Audio";
import { DevTools } from "./DevTools";
import { History } from "./History";
import { Live } from "./Live";
import { LiveLog } from "./LiveLog";
import { Settings, Workspace } from "./Workspace";

type Status = "ok" | "off" | "unknown";

function Dot({ status }: { status: Status }) {
  const symbol = status === "ok" ? "🟢" : status === "off" ? "🔴" : "⚪";
  return <span aria-label={status}>{symbol}</span>;
}

const SERVER_DOT: Record<string, Status> = { connected: "ok", disconnected: "off" };

const CLAUDE_DOT: Record<string, Status> = { active: "ok", linked: "ok", off: "off" };
const CLAUDE_TEXT: Record<string, string> = {
  active: "Claude (faol)",
  linked: "Claude (ulangan)",
  off: "Claude ulanmagan",
  unknown: "Claude",
};

function ClaudeStatus({ agent }: { agent: NonNullable<ReturnType<typeof getAgent>> }) {
  const status = useSyncExternalStore(
    (notify) => agent.claude.subscribe(notify),
    () => agent.claude.current(),
  );
  // Faollik vaqt o'tishi bilan o'zgaradi: daqiqada bir qayta hisoblanadi.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, []);
  const indicator = claudeIndicator(status);
  return (
    <div>
      <Dot status={CLAUDE_DOT[indicator] ?? "unknown"} /> {CLAUDE_TEXT[indicator]}
    </div>
  );
}

function ElevenStatus({ agent }: { agent: NonNullable<ReturnType<typeof getAgent>> }) {
  const status = useSyncExternalStore(
    (notify) => agent.eleven.subscribe(notify),
    () => agent.eleven.current(),
  );
  const dot: Status = status === null ? "unknown" : status.ok ? "ok" : "off";
  const text =
    status === null
      ? "ElevenLabs"
      : !status.configured
        ? "ElevenLabs: kalit yo'q"
        : status.ok
          ? `ElevenLabs${status.remaining !== null ? ` (${status.remaining.toLocaleString()})` : ""}`
          : "ElevenLabs: xato";
  return (
    <div>
      <Dot status={dot} /> {text}
    </div>
  );
}

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
        {agent === null ? (
          <div>
            <Dot status="unknown" /> Claude
          </div>
        ) : (
          <ClaudeStatus agent={agent} />
        )}
        {agent === null ? (
          <div>
            <Dot status="unknown" /> ElevenLabs
          </div>
        ) : (
          <ElevenStatus agent={agent} />
        )}
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
      <Live agent={agent} />
      <Audio agent={agent} connected={status === "connected"} />
      <History agent={agent} connected={status === "connected"} />
      <DevTools agent={agent} />
      <Settings agent={agent} onChange={(s) => setLogLevel(s.log_level)} />
      <LiveLog store={agent.log} minLevel={logLevel} />
    </>
  );
}
