/** Holat qatoridagi Claude indikatori (§11.1): serverdan `claude.status`. */

export interface ClaudeStatus {
  /** Faol OAuth tokeni bor (connector ulangan). */
  linked: boolean;
  last_seen_at: string | null;
}

/** Oxirgi MCP chaqiruvi shu muddat ichida bo'lsa — faol (🟢). */
export const CLAUDE_ACTIVE_MS = 15 * 60_000;

export type ClaudeIndicator = "active" | "linked" | "off" | "unknown";

export function claudeIndicator(status: ClaudeStatus | null, now = Date.now()): ClaudeIndicator {
  if (status === null) return "unknown";
  if (status.last_seen_at !== null && now - Date.parse(status.last_seen_at) < CLAUDE_ACTIVE_MS) {
    return "active";
  }
  return status.linked ? "linked" : "off";
}

export class ClaudeStatusStore {
  private status: ClaudeStatus | null = null;
  private readonly listeners = new Set<() => void>();

  current(): ClaudeStatus | null {
    return this.status;
  }

  set(status: ClaudeStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
