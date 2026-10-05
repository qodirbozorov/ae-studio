/**
 * Live ekrani holati (§11.1, P2.12): serverdan `job.update` / `job.event` → UI obunachilari.
 * Faqat shu qurilmaning aktiv (yoki oxirgi) job'i saqlanadi.
 */
import type { AesError, JobOutcome, JobState, LogLevel, ServerMessageOf } from "@aes/shared";

export interface LiveJob {
  id: string;
  state: JobState;
  prev_state?: JobState;
  progress: { done: number; total: number };
  scene_id?: string;
  paused: boolean;
  outcome?: JobOutcome;
  error?: AesError;
}

export interface LiveEvent {
  ts: string;
  level: LogLevel;
  type: string;
  op_id?: string;
  message: string;
  data?: unknown;
}

const EVENT_LIMIT = 300;

export class LiveJobStore {
  private job: LiveJob | null = null;
  private list: LiveEvent[] = [];
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  current(): LiveJob | null {
    return this.job;
  }

  events(): readonly LiveEvent[] {
    return this.list;
  }

  /** UI snapshot kaliti (`useSyncExternalStore`). */
  version(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Yangi job bo'lsa `true` (chaqiruvchi tarixni yuklaydi). */
  applyUpdate(message: ServerMessageOf<"job.update">): boolean {
    const isNew = this.job?.id !== message.job_id;
    if (isNew) this.list = [];
    const next: LiveJob = {
      id: message.job_id,
      state: message.state,
      progress: message.progress,
      paused: message.paused ?? false,
    };
    if (message.prev_state !== undefined) next.prev_state = message.prev_state;
    // Sahna faqat BUILD paytida keladi: progress yangilanmagan xabarlarda oldingisi saqlanadi.
    const scene = message.scene_id ?? (isNew ? undefined : this.job?.scene_id);
    if (scene !== undefined && message.state === "BUILD") next.scene_id = scene;
    if (message.outcome !== undefined) next.outcome = message.outcome;
    if (message.error !== undefined) next.error = message.error;
    this.job = next;
    this.changed();
    return isNew;
  }

  applyEvent(message: ServerMessageOf<"job.event">): void {
    if (this.job !== null && this.job.id !== message.job_id) return;
    this.push([message.event as LiveEvent]);
  }

  /** Serverdagi tarix (`/api/agent/jobs/:id/events`): jonli kelganlar bilan birlashtiriladi. */
  setHistory(jobId: string, history: LiveEvent[]): void {
    if (this.job?.id !== jobId) return;
    const seen = new Set(history.map(key));
    this.list = [...history, ...this.list.filter((event) => !seen.has(key(event)))];
    this.trim();
    this.changed();
  }

  private push(events: LiveEvent[]): void {
    this.list = [...this.list, ...events];
    this.trim();
    this.changed();
  }

  private trim(): void {
    if (this.list.length > EVENT_LIMIT) this.list = this.list.slice(-EVENT_LIMIT);
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

function key(event: LiveEvent): string {
  return `${event.ts}|${event.type}|${event.op_id ?? ""}|${event.message}`;
}
