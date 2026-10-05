import type { LogLevel } from "@aes/shared";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  message: string;
  op_id?: string;
  job_id?: string;
  data?: unknown;
}

export type LogInput = Omit<LogEntry, "id" | "ts">;

/** Panel live log'i: oxirgi N yozuv (halqa bufer) + obunachilar (UI, WS). */
export class LogStore {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private nextId = 1;

  constructor(
    private readonly limit = 500,
    private readonly now: () => number = Date.now,
  ) {}

  add(input: LogInput): LogEntry {
    const entry: LogEntry = { id: this.nextId++, ts: this.now(), ...input };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  list(): readonly LogEntry[] {
    return this.entries;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
