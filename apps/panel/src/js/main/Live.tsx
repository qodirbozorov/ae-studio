import { useState, useSyncExternalStore } from "react";
import { JOB_FLOW } from "@aes/shared";
import type { Agent, PanelJobAction } from "../../agent";
import type { LiveJobStore } from "../../agent/live";

function useLive(store: LiveJobStore) {
  useSyncExternalStore(
    (notify) => store.subscribe(notify),
    () => store.version(),
  );
  return { job: store.current(), events: store.events() };
}

const STATE_LABEL: Record<string, string> = {
  BLOCKED: "⛔ To'xtadi",
  WAITING_AGENT: "⏳ Panel kutilmoqda",
};

function time(iso: string): string {
  return new Date(iso).toTimeString().slice(0, 8);
}

/** Live ekrani (§11.1): holat zanjiri, progress, joriy sahna, job log'i, boshqaruv. */
export function Live({ agent }: { agent: Agent }) {
  const { job, events } = useLive(agent.live);
  const [busy, setBusy] = useState<PanelJobAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (job === null) {
    return (
      <section className="dev">
        <h2>Live</h2>
        <p className="hint">Aktiv job yo'q. Claude yoki kabinetdan job boshlang.</p>
      </section>
    );
  }

  const run = (action: PanelJobAction) => {
    setBusy(action);
    setError(null);
    void agent
      .jobAction(action)
      .then((res) => setError(res.ok ? null : (res.message ?? "Xato")))
      .finally(() => setBusy(null));
  };

  const done = job.state === "DONE";
  // Side-holatlarda zanjirdagi o'rin prev_state bo'yicha ko'rsatiladi.
  const position = JOB_FLOW.indexOf(
    (job.state === "BLOCKED" || job.state === "WAITING_AGENT"
      ? (job.prev_state ?? "CHECK")
      : job.state) as (typeof JOB_FLOW)[number],
  );
  const percent =
    job.progress.total === 0 ? 0 : Math.round((job.progress.done / job.progress.total) * 100);

  return (
    <section className="dev" aria-label="Live">
      <h2>Live</h2>
      <ol className="chain">
        {JOB_FLOW.map((state, index) => (
          <li
            key={state}
            className={
              index < position ? "chain-done" : index === position ? "chain-current" : undefined
            }
          >
            {state}
          </li>
        ))}
      </ol>
      <p className="hint">
        {STATE_LABEL[job.state] ?? job.state}
        {job.paused ? " · ⏸ pauza" : ""}
        {job.scene_id !== undefined ? ` · sahna: ${job.scene_id}` : ""}
        {done && job.outcome !== undefined ? ` · ${job.outcome}` : ""}
      </p>
      {job.error !== undefined ? (
        <p className="error-text">
          {job.error.code}: {job.error.message ?? ""} — {job.error.hint}
        </p>
      ) : null}
      {job.progress.total > 0 ? (
        <div className="progress" aria-label={`${job.progress.done}/${job.progress.total}`}>
          <div className="progress-bar" style={{ width: `${percent}%` }} />
          <span>
            {job.progress.done}/{job.progress.total} op
          </span>
        </div>
      ) : null}
      {!done ? (
        <div className="buttons">
          {job.paused ? (
            <button disabled={busy !== null} onClick={() => run("resume")}>
              ▶ Resume
            </button>
          ) : (
            <button disabled={busy !== null || job.state === "REPORT"} onClick={() => run("pause")}>
              ⏸ Pause
            </button>
          )}
          <button
            disabled={busy !== null || !job.paused || job.state !== "BUILD"}
            title="Pauzada: AE'dagi oxirgi opni bekor qiladi"
            onClick={() => run("undo")}
          >
            ↩ Undo last
          </button>
          <button
            disabled={busy !== null || job.state === "REPORT"}
            onClick={() => {
              if (window.confirm("Job bekor qilinsinmi? AE'dagi qurilgan qism saqlanib qoladi.")) {
                run("cancel");
              }
            }}
          >
            ⏹ Cancel
          </button>
        </div>
      ) : null}
      {error !== null ? <p className="error-text">{error}</p> : null}
      <div className="log job-log">
        {events
          .filter((event) => event.level !== "debug")
          .slice(-100)
          .map((event, index) => (
            <div key={`${event.ts}-${index}`} className={`log-row log-${event.level}`}>
              <span className="log-time">{time(event.ts)}</span>
              <span className="log-message">{event.message}</span>
            </div>
          ))}
      </div>
    </section>
  );
}
