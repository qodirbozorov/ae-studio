import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LogEntry } from "../../agent";
import type { LogStore } from "../../agent/log";

function useLog(store: LogStore): readonly LogEntry[] {
  // Store har yozuvda massivni o'zgartiradi: snapshot sifatida uzunlik + oxirgi id ishlatiladi.
  const version = useSyncExternalStore(
    (notify) => store.subscribe(notify),
    () => {
      const list = store.list();
      return `${list.length}:${list[list.length - 1]?.id ?? 0}`;
    },
  );
  void version;
  return store.list();
}

function time(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

/** Live log: ⏳ → ✅ / ❌ (§11.1 "Live"). */
export function LiveLog({ store }: { store: LogStore }) {
  const entries = useLog(store);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  return (
    <section className="log" aria-label="Live log">
      {entries.length === 0 ? <div className="log-empty">Hali hech narsa bajarilmadi</div> : null}
      {entries.map((entry) => (
        <div key={entry.id} className={`log-row log-${entry.level}`}>
          <span className="log-time">{time(entry.ts)}</span>
          <span className="log-message">{entry.message}</span>
        </div>
      ))}
      <div ref={bottom} />
    </section>
  );
}
