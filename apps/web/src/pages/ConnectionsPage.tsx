import { useEffect, useState } from "react";
import { api, post } from "../api";

interface Connection {
  client_id: string;
  client_name: string | null;
  kind: string;
  redirect_hosts: string[];
  last_authorized_at: string;
  active_tokens: number;
}

interface AuditRow {
  ts: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
}

const ACTION: Record<string, string> = {
  "oauth.authorized": "Ilovaga ruxsat berildi",
  "oauth.denied": "Ilova rad etildi",
  "oauth.revoked": "Ilova uzildi",
  "oauth.refresh_reuse": "⚠️ Eski token qayta ishlatildi — ulanish bekor qilindi",
  "device.approved": "Qurilma ulandi",
  "device.denied": "Qurilma rad etildi",
  "device.revoked": "Qurilma bekor qilindi",
};

function when(value: string): string {
  return new Date(value).toLocaleString("uz-UZ");
}

function describe(row: AuditRow): string {
  if (row.action.startsWith("mcp.")) return `Claude: ${row.action.slice(4)}`;
  return ACTION[row.action] ?? row.action;
}

/** "Ulangan ilovalar" (Claude connector tokenlari) va xavfsizlik jurnali (P3.10). */
export function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [events, setEvents] = useState<AuditRow[]>([]);

  const load = async () => {
    const [list, log] = await Promise.all([
      api<Connection[]>("/api/oauth/connections"),
      api<AuditRow[]>("/api/audit"),
    ]);
    setConnections(list.ok ? list.data : []);
    setEvents(log.ok ? log.data : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (clientId: string) => {
    await post("/api/oauth/connections/revoke", { client_id: clientId });
    await load();
  };

  return (
    <>
      <section className="card">
        <h2>Ulangan ilovalar</h2>
        {connections === null ? <p>Yuklanmoqda…</p> : null}
        {connections?.length === 0 ? (
          <p className="muted">
            Hali ilova ulanmagan. Claude'da: Settings → Connectors → Add custom connector →{" "}
            <code>{window.location.origin}/mcp</code>
          </p>
        ) : null}
        <ul className="devices">
          {connections?.map((c) => (
            <li key={c.client_id}>
              <div>
                <b>{c.client_name ?? "Noma'lum ilova"}</b>{" "}
                <span className="muted">{c.redirect_hosts.join(", ")}</span>
                <div className="muted small">
                  ruxsat: {when(c.last_authorized_at)} · faol tokenlar: {c.active_tokens}
                </div>
              </div>
              <button className="secondary" onClick={() => revoke(c.client_id)}>
                Uzish
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Faollik</h2>
        {events.length === 0 ? <p className="muted">Hali yozuv yo'q.</p> : null}
        <ul className="devices">
          {events.map((e, index) => (
            <li key={`${e.ts}-${index}`}>
              <div>
                {describe(e)} {e.target ? <span className="muted">· {e.target}</span> : null}
                <div className="muted small">
                  {when(e.ts)}
                  {e.ip ? ` · ${e.ip}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
