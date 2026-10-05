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
const RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;

export function LiveLog({
  store,
  minLevel = "info",
}: {
  store: LogStore;
  minLevel?: keyof typeof RANK;
}) {
  const entries = useLog(store).filter((entry) => RANK[entry.level] >= RANK[minLevel]);
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
