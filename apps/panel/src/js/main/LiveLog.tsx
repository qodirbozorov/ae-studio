import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Info,
  Loader,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LogEntry } from "../../agent";
import type { LogStore } from "../../agent/log";
import { describeLog } from "./logText";
import type { LogKind } from "./logText";

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

const RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const ICON: Record<LogKind, LucideIcon> = {
  running: Loader,
  done: CircleCheck,
  error: CircleX,
  warn: TriangleAlert,
  info: Info,
};

type Filter = "all" | "problems";

/** Live log: pastda qat'iy balandlikdagi blok, tushunarli matn, rangli turlar, filtr va tozalash. */
export function LiveLog({
  store,
  minLevel = "info",
}: {
  store: LogStore;
  minLevel?: keyof typeof RANK;
}) {
  const all = useLog(store);
  const [clearedAt, setClearedAt] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState(true);
  const [tall, setTall] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const visible = all.filter((e) => e.id > clearedAt && RANK[e.level] >= RANK[minLevel]);
  const problems = visible.filter((e) => e.level === "warn" || e.level === "error").length;
  const entries =
    filter === "problems"
      ? visible.filter((e) => e.level === "warn" || e.level === "error")
      : visible;
  const last = entries.slice(-200);

  useEffect(() => {
    const el = list.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [last.length, open, filter]);

  return (
    <section
      className={`log-dock${open ? "" : " closed"}${tall ? " tall" : ""}`}
      aria-label="Live log"
    >
      <div className="log-bar">
        <button
          className="ghost"
          onClick={() => setOpen(!open)}
          title={open ? "Yig'ish" : "Ochish"}
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />} Faollik
        </button>
        <div className="chips">
          <button
            className={`chip${filter === "all" ? " on" : ""}`}
            onClick={() => setFilter("all")}
          >
            Hammasi {visible.length}
          </button>
          <button
            className={`chip${filter === "problems" ? " on" : ""}${problems > 0 ? " warn" : ""}`}
            onClick={() => setFilter("problems")}
          >
            Muammolar {problems}
          </button>
        </div>
        <button className="ghost" onClick={() => setTall(!tall)} title="Balandlik">
          {tall ? "Kichik" : "Katta"}
        </button>
        <button
          className="ghost"
          onClick={() => setClearedAt(all[all.length - 1]?.id ?? 0)}
          title="Tozalash"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {open ? (
        <div className="log-list" ref={list}>
          {last.length === 0 ? <div className="log-empty">Hali hech narsa bajarilmadi</div> : null}
          {last.map((entry) => {
            const view = describeLog(entry);
            const Icon = ICON[view.kind];
            return (
              <div key={entry.id} className={`log-row k-${view.kind}`}>
                <Icon size={13} className={`log-icon${view.kind === "running" ? " spin" : ""}`} />
                <div className="log-body">
                  <div className="log-title">
                    {view.title}
                    {view.code ? <span className="code-badge">{view.code}</span> : null}
                  </div>
                  {view.detail ? <div className="log-detail">{view.detail}</div> : null}
                </div>
                <span className="log-time">{time(entry.ts)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
