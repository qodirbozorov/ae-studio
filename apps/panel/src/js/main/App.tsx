import { useEffect, useState } from "react";
import pkg from "../../../package.json";
import { hostEnvironment, isCep, panelBackground } from "../lib/cep";

type Status = "ok" | "off" | "unknown";

function Dot({ status }: { status: Status }) {
  const symbol = status === "ok" ? "🟢" : status === "off" ? "🔴" : "⚪";
  return <span aria-label={status}>{symbol}</span>;
}

export function App() {
  const [background, setBackground] = useState<string | null>(null);
  const host = hostEnvironment();

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
        <div>
          <Dot status="unknown" /> Server
        </div>
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
    </main>
  );
}
