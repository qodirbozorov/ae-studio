import { useEffect, useState } from "react";
import type { Agent, HistoryJob } from "../../agent";

const OUTCOME: Record<string, string> = { success: "✅", cancelled: "⏹", failed: "❌" };

function when(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toTimeString().slice(0, 5)}`;
}

/** Tarix ekrani (§11.1.4): joblar, hisobotni ochish, qayta render. */
export function History({ agent, connected }: { agent: Agent; connected: boolean }) {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [open, setOpen] = useState<{ id: string; markdown: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    if (!connected) return;
    setLoading(true);
    agent
      .history()
      .then(setJobs, (e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [agent, connected]);

  const showReport = async (id: string) => {
    if (open?.id === id) {
      setOpen(null);
      return;
    }
    const markdown = await agent.jobReport(id);
    setOpen({ id, markdown: markdown ?? "Hisobot hali yo'q" });
  };

  const rerender = async (id: string) => {
    setMessage(null);
    const res = await agent.renderAgain(id);
    setMessage(res.ok ? "🎬 Qayta render boshlandi (natija Live log'da)" : (res.message ?? "Xato"));
    refresh();
  };

  return (
    <section className="dev" aria-label="Tarix">
      <h2>Tarix</h2>
      <div className="buttons">
        <button disabled={!connected || loading} onClick={refresh}>
          {loading ? "Yuklanmoqda…" : "Yangilash"}
        </button>
      </div>
      {message !== null ? <p className="hint">{message}</p> : null}
      {jobs.length === 0 ? <p className="hint">Hali job yo'q.</p> : null}
      <ul className="recent history">
        {jobs.map((job) => {
          const video = job.renders.find((r) => r.status === "done");
          return (
            <li key={job.id}>
              <div>
                {job.outcome !== null ? (OUTCOME[job.outcome] ?? "") : "⏳"}{" "}
                <b>{job.project_name}</b>{" "}
                <span className="muted">
                  {job.state} · plan v{job.plan_version} · {when(job.created_at)}
                </span>
              </div>
              {job.aep_path !== null ? <div className="muted">{job.aep_path}</div> : null}
              {video !== undefined ? <div className="muted">🎞 {video.local_path}</div> : null}
              <div className="buttons">
                <button className="link-button" onClick={() => void showReport(job.id)}>
                  {open?.id === job.id ? "Yopish" : "Hisobot"}
                </button>
                {job.state === "DONE" && job.aep_path !== null ? (
                  <button
                    className="link-button"
                    disabled={!connected}
                    onClick={() => void rerender(job.id)}
                  >
                    Qayta render
                  </button>
                ) : null}
              </div>
              {open?.id === job.id ? <pre className="report">{open.markdown}</pre> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
