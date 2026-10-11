import { Bot, Clock, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "../api";
import {
  Button,
  Card,
  Empty,
  Figure,
  IconWell,
  Label,
  Loading,
  Meta,
  PageTitle,
  Pill,
  ago,
} from "../ui";

interface Connection {
  client_id: string;
  client_name: string | null;
  kind: string;
  redirect_hosts: string[];
  last_authorized_at: string;
  active_tokens: number;
}

/** "Ulangan ilovalar": Claude connector tokenlari (P3.10). Faollik jurnali — Audit sahifasida. */
export function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);

  const load = async () => {
    const list = await api<Connection[]>("/api/oauth/connections");
    setConnections(list.ok ? list.data : []);
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (clientId: string) => {
    if (!window.confirm("Ilova uzilsinmi? Claude qayta ulanishi kerak bo'ladi.")) return;
    await post("/api/oauth/connections/revoke", { client_id: clientId });
    await load();
  };

  return (
    <>
      <PageTitle title="Ulangan" muted="ilovalar" />
      {connections === null ? <Loading /> : null}
      {connections?.length === 0 ? (
        <Card>
          <Empty>
            Hali ilova ulanmagan. Claude'da: Settings → Connectors → Add custom connector →{" "}
            <code>{window.location.origin}/mcp</code>
          </Empty>
        </Card>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {connections?.map((c) => (
          <Card key={c.client_id} className="flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-[1.6rem] leading-tight font-normal tracking-[-0.025em]">
                  {c.client_name ?? "Noma'lum ilova"}
                </h2>
                <div className="mt-1 truncate text-[0.95rem] text-ink-3">
                  {c.redirect_hosts.join(", ")}
                </div>
              </div>
              <IconWell icon={Bot} />
            </div>
            <div className="mt-10">
              <Label>Faol tokenlar</Label>
              <div className="mt-3 mb-5">
                <Figure value={c.active_tokens} />
              </div>
              <Pill tone={c.active_tokens > 0 ? "go" : "neutral"} dot={c.active_tokens > 0}>
                {c.active_tokens > 0 ? "Ulangan" : "Faol token yo'q"}
              </Pill>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-6">
              <Meta icon={Clock}>Oxirgi ruxsat: {ago(c.last_authorized_at)}</Meta>
              <Button size="sm" variant="danger" onClick={() => void revoke(c.client_id)}>
                <Unplug /> Uzish
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
