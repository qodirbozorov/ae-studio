import {
  AudioLines,
  Bot,
  Clapperboard,
  FolderOpen,
  History as HistoryIcon,
  LayoutTemplate,
  Server,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { Templates } from "./Templates";
import { FirstRun } from "./FirstRun";

type Status = "ok" | "off" | "unknown" | "busy";

/** Holat "pill"i: ikonka + rangli nuqta + qisqa matn. */
function Pill({
  status,
  icon: Icon,
  children,
}: {
  status: Status;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className={`pill s-${status}`}>
      <Icon size={13} />
      <span className="pill-dot" />
      <span className="pill-text">{children}</span>
    </div>
  );
}

const SERVER_DOT: Record<string, Status> = {
  connected: "ok",
  connecting: "busy",
  disconnected: "off",
  unauthorized: "off",
};
const SERVER_TEXT: Record<string, string> = {
  connected: "Server",
  connecting: "Ulanmoqda…",
  disconnected: "Aloqa yo'q",
  unauthorized: "Rad etildi",
};

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
    <Pill status={CLAUDE_DOT[indicator] ?? "unknown"} icon={Bot}>
      {CLAUDE_TEXT[indicator]}
    </Pill>
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
    <Pill status={dot} icon={AudioLines}>
      {text}
    </Pill>
  );
}

function ServerStatus({ agent }: { agent: NonNullable<ReturnType<typeof getAgent>> }) {
  const status = useConnectionStatus(agent);
  return (
    <Pill status={SERVER_DOT[status] ?? "unknown"} icon={Server}>
      {SERVER_TEXT[status] ?? "Server"}
    </Pill>
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
        <h1>
          <Clapperboard size={15} /> AE Studio
        </h1>
        <span className="version">v{pkg.version}</span>
      </header>

      <section className="status">
        {agent === null ? (
          <Pill status="unknown" icon={Server}>
            Server
          </Pill>
        ) : (
          <ServerStatus agent={agent} />
        )}
        <Pill status={isCep() ? "ok" : "off"} icon={Clapperboard}>
          AE {host ? host.appVersion : "(CEP tashqarisida)"}
        </Pill>
        {agent === null ? (
          <Pill status="unknown" icon={Bot}>
            Claude
          </Pill>
        ) : (
          <ClaudeStatus agent={agent} />
        )}
        {agent === null ? (
          <Pill status="unknown" icon={AudioLines}>
            ElevenLabs
          </Pill>
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
  // Birinchi ishga tushirishda faqat sozlash bo'limlari ko'rinadi (P5.11).
  const [ready, setReady] = useState(agent.onboarding() === "done");
  return (
    <>
      {ready ? null : <FirstRun agent={agent} onDone={() => setReady(true)} />}
      <Connection agent={agent} status={status} />
      {ready ? (
        <Workbench agent={agent} status={status} onLogLevel={setLogLevel} />
      ) : (
        <Workspace agent={agent} connected={status === "connected"} />
      )}
      <LiveLog store={agent.log} minLevel={logLevel} />
    </>
  );
}

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: "work", label: "Ish", icon: FolderOpen },
  { key: "templates", label: "Shablon", icon: LayoutTemplate },
  { key: "audio", label: "Audio", icon: AudioLines },
  { key: "history", label: "Tarix", icon: HistoryIcon },
  { key: "settings", label: "Sozlama", icon: SettingsIcon },
];

const TAB_KEY = "aes.tab";

function Workbench({
  agent,
  status,
  onLogLevel,
}: {
  agent: NonNullable<ReturnType<typeof getAgent>>;
  status: ReturnType<typeof useConnectionStatus>;
  onLogLevel: (
    level: ReturnType<NonNullable<ReturnType<typeof getAgent>>["settings"]>["log_level"],
  ) => void;
}) {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem(TAB_KEY) ?? "work";
    } catch {
      return "work";
    }
  });
  const choose = (key: string) => {
    setTab(key);
    try {
      localStorage.setItem(TAB_KEY, key);
    } catch {
      // saqlab bo'lmasa ham ishlaydi
    }
  };
  const connected = status === "connected";
  return (
    <>
      <nav className="tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`tab${tab === key ? " on" : ""}`}
            onClick={() => choose(key)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "work" ? (
          <>
            <Workspace agent={agent} connected={connected} />
            <Live agent={agent} />
          </>
        ) : null}
        {tab === "templates" ? <Templates agent={agent} connected={connected} /> : null}
        {tab === "audio" ? <Audio agent={agent} connected={connected} /> : null}
        {tab === "history" ? <History agent={agent} connected={connected} /> : null}
        {tab === "settings" ? (
          <>
            <Settings agent={agent} onChange={(s) => onLogLevel(s.log_level)} />
            <DevTools agent={agent} />
          </>
        ) : null}
      </div>
    </>
  );
}
