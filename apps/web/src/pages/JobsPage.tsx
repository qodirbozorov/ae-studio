import { ChevronDown, ChevronUp, CircleX, FileText, Film, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, CardTitle, Count, Empty, Loading, Meta, PageTitle, StateBadge } from "../ui";

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

  return (
    <>
      <PageTitle title="Job" muted="tarixi" />
      {jobs === null ? <Loading /> : null}

      {batches.length > 0 ? (
        <Card className="mb-6">
          <CardTitle>Batch'lar</CardTitle>
          <ul className="grid gap-1">
            {batches.map((b) => (
              <li
                key={b.id}
                className="-mx-3 flex flex-wrap items-center justify-between gap-3 rounded-[1rem] px-3 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Layers className="h-5 w-5 shrink-0 text-ink-4" />
                  <div className="min-w-0">
                    <div className="truncate text-[1.02rem] font-normal">{b.template}</div>
                    <div className="text-sm text-ink-3">
                      {b.status} · {date(b.created_at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Count tone="mint">
                    {b.done}/{b.total}
                  </Count>
                  {b.failed > 0 ? <Count tone="peach">{b.failed} xato</Count> : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {jobs !== null ? (
        <Card>
          <CardTitle>Joblar</CardTitle>
          {jobs.length === 0 ? (
            <Empty>Hali job yo'q: Claude yoki panel orqali video yarating.</Empty>
          ) : null}
          <ul className="divide-y divide-hair">
            {jobs.map((job) => (
              <li key={job.id} className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[1.1rem] font-normal tracking-[-0.01em]">
                      {job.project_name}
                    </div>
                    <div className="num mt-0.5 text-sm text-ink-3">
                      plan v{job.plan_version} · {date(job.created_at)}
                      {job.batch_id !== null ? " · batch" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StateBadge state={job.state} outcome={job.outcome} />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open === job.id}
                      onClick={() => void toggle(job.id)}
                    >
                      <FileText /> Hisobot
                      {open === job.id ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </div>
                </div>
                {job.error !== null && job.state !== "DONE" ? (
                  <div className="mt-3 flex items-start gap-2 text-sm font-normal text-stop">
                    <CircleX className="mt-px h-4 w-4 shrink-0" />
                    <span className="break-words">
                      {job.error.code}: {job.error.message}
                    </span>
                  </div>
                ) : null}
                {job.renders.some((r) => r.status === "done") ? (
                  <div className="mt-3 grid gap-1.5">
                    {job.renders
                      .filter((r) => r.status === "done")
                      .map((r) => (
                        <Meta key={r.id} icon={Film} title={r.local_path}>
                          {r.local_path} ({r.preset})
                        </Meta>
                      ))}
                  </div>
                ) : null}
                {open === job.id ? (
                  <pre className="mt-4 max-h-96 overflow-auto rounded-[1.25rem] bg-well/70 p-5 font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap text-ink-2">
                    {report ?? "Yuklanmoqda…"}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
