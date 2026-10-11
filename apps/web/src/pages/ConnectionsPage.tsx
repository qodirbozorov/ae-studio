import { Badge, Button, Card, Spinner } from "flowbite-react";
import { Bot, Plug, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Empty, ago } from "../ui";

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
    <section>
      <h1 className="mb-4 text-xl font-semibold">Ulangan ilovalar</h1>
      {connections === null ? <Spinner /> : null}
      {connections?.length === 0 ? (
        <Card>
          <Empty>
            Hali ilova ulanmagan. Claude'da: Settings → Connectors → Add custom connector →{" "}
            <code>{window.location.origin}/mcp</code>
          </Empty>
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {connections?.map((c) => (
          <Card key={c.client_id}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
                  <Bot className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-semibold">{c.client_name ?? "Noma'lum ilova"}</div>
                  <div className="text-xs text-gray-500">{c.redirect_hosts.join(", ")}</div>
                </div>
              </div>
              <Badge color={c.active_tokens > 0 ? "success" : "gray"} icon={Plug}>
                {c.active_tokens} faol
              </Badge>
            </div>
            <div className="text-sm text-gray-500">Oxirgi ruxsat: {ago(c.last_authorized_at)}</div>
            <Button
              size="xs"
              color="red"
              outline
              className="w-fit"
              onClick={() => revoke(c.client_id)}
            >
              <Unplug className="mr-1 h-3.5 w-3.5" /> Uzish
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
