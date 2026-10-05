/** Audio ekrani holati (P4.12): serverdan ro'yxat + `audio.update` jonli yangilanishlar. */
import type { ServerMessageOf } from "@aes/shared";

export type AudioTaskView = ServerMessageOf<"audio.update">["task"];

export class AudioStore {
  private tasks = new Map<string, AudioTaskView>();
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  list(projectId?: string | null): AudioTaskView[] {
    return [...this.tasks.values()]
      .filter((task) => projectId == null || task.project_id === projectId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  version(): number {
    return this.revision;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replace(tasks: AudioTaskView[]): void {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
    this.changed();
  }

  upsert(task: AudioTaskView): void {
    this.tasks.set(task.id, task);
    this.changed();
  }

  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
