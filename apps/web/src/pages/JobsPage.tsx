import { useEffect, useState } from "react";
import { api } from "../api";

interface HistoryJob {
  id: string;
  project_name: string;
  state: string;
  outcome: string | null;
  plan_version: number;
  created_at: string;
  error: { code: string; message?: string } | null;
  batch_id: string | null;
  renders: { id: string; status: string; preset: string; local_path: string }[];
}

interface Batch {
  id: string;
  template: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  created_at: string;
}

const STATE: Record<string, string> = {
  DONE: "✅",
  BLOCKED: "⛔",
  WAITING_AGENT: "🔌",
  VERIFY: "👀",
  RENDER: "🎬",
};

const OUTCOME: Record<string, string> = {
  success: "tayyor",
  cancelled: "bekor qilingan",
  failed: "xato",
};

const date = (iso: string) => new Date(iso).toLocaleString("uz-UZ");

/** Job tarixi va hisobotlar (P5.09): barcha loyihalar bo'yicha oxirgi joblar va batch'lar. */
export function JobsPage() {
  const [jobs, setJobs] = useState<HistoryJob[] | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  useEffect(() => {
    void api<HistoryJob[]>("/api/jobs").then((res) => setJobs(res.ok ? res.data : []));
    void api<Batch[]>("/api/batches").then((res) => setBatches(res.ok ? res.data : []));
  }, []);

  const toggle = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    setReport(null);
    const res = await api<{ markdown: string }>(`/api/jobs/${id}/report`);
    setReport(res.ok ? res.data.markdown : "Hisobot hali yo'q (job tugamagan).");
  };

  if (jobs === null) return <section>Yuklanmoqda…</section>;
  return (
    <section>
      {batches.length > 0 ? (
        <>
          <h2>Batch'lar</h2>
          <ul className="list">
            {batches.map((b) => (
              <li key={b.id}>
                <b>{b.template}</b> · {b.status} · {b.done}/{b.total}
                {b.failed > 0 ? ` · ${b.failed} xato` : ""}{" "}
                <span className="muted">{date(b.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>Joblar</h2>
      {jobs.length === 0 ? (
        <p className="muted">Hali job yo'q: Claude yoki panel orqali video yarating.</p>
      ) : null}
      <ul className="list">
        {jobs.map((job) => (
          <li key={job.id}>
            <div>
              {STATE[job.state] ?? "⏳"} <b>{job.project_name}</b> · plan v{job.plan_version} ·{" "}
              {job.state === "DONE" ? (OUTCOME[job.outcome ?? ""] ?? job.outcome) : job.state}
              {job.batch_id !== null ? " · batch" : ""}{" "}
              <span className="muted">{date(job.created_at)}</span>
            </div>
            {job.error !== null && job.state !== "DONE" ? (
              <div className="error-text">
                {job.error.code}: {job.error.message}
              </div>
            ) : null}
            {job.renders
              .filter((r) => r.status === "done")
              .map((r) => (
                <div key={r.id} className="muted">
                  🎞 {r.local_path} ({r.preset})
                </div>
              ))}
            <button className="link" onClick={() => void toggle(job.id)}>
              {open === job.id ? "Yopish" : "Hisobot"}
            </button>
            {open === job.id ? <pre className="report">{report ?? "Yuklanmoqda…"}</pre> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
