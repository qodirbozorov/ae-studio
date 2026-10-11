import {
  CircleCheck,
  CircleX,
  Clock,
  Loader,
  Play,
  RefreshCw,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Agent } from "../../agent";

const KIND: Record<string, string> = {
  tts: "Ovoz (TTS)",
  dialogue: "Dialog",
  sfx: "SFX",
  music: "Musiqa",
  stt: "Transkript",
  align: "Alignment",
  isolate: "Toza ovoz",
  voice_change: "Ovoz almashtirish",
  dub: "Dublyaj",
  voice_design: "Ovoz dizayni",
};

const STATUS: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  queued: { icon: Clock, tone: "dim-icon", label: "navbatda" },
  running: { icon: Loader, tone: "warn-icon spin", label: "ishlanmoqda" },
  done: { icon: CircleCheck, tone: "ok-icon", label: "tayyor" },
  failed: { icon: CircleX, tone: "bad-icon", label: "xato" },
  skipped: { icon: SkipForward, tone: "dim-icon", label: "o'tkazildi" },
};

function fileUrl(path: string): string {
  return encodeURI(`file:///${path.replace(/^\/+/, "")}`);
}

/** Audio ekrani (§11.1.6): ElevenLabs fayllari, eshitish, qayta generatsiya. */
export function Audio({ agent, connected }: { agent: Agent; connected: boolean }) {
  useSyncExternalStore(
    (notify) => agent.audio.subscribe(notify),
    () => agent.audio.version(),
  );
  const project = agent.currentProject();
  const tasks = agent.audio.list(project?.id ?? null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (connected && project !== null) void agent.loadAudio(project.id).catch(() => undefined);
  }, [agent, connected, project?.id]);

  const act = async (id: string, action: "regenerate" | "retry") => {
    setMessage(null);
    const res = await agent.audioAction(id, action);
    if (!res.ok) setMessage(res.message ?? "Xato");
  };

  return (
    <section className="dev" aria-label="Audio">
      <h2>Audio</h2>
      {project === null ? <p className="hint">Avval ish papkasini tanlang.</p> : null}
      {project !== null && tasks.length === 0 ? (
        <p className="hint">
          Hali audio yo'q: Claude ElevenLabs orqali yaratgan fayllar shu yerda chiqadi.
        </p>
      ) : null}
      {message !== null ? <p className="error-text">{message}</p> : null}
      <ul className="recent history">
        {tasks.slice(0, 30).map((task) => {
          const path = task.local_path === null ? null : agent.absolutePath(task.local_path);
          const status = STATUS[task.status];
          const Icon = status?.icon ?? Clock;
          return (
            <li key={task.id}>
              <div className="row-title" title={status?.label ?? task.status}>
                <Icon size={15} className={status?.tone ?? "dim-icon"} />
                <b>{task.label ?? KIND[task.kind] ?? task.kind}</b>
              </div>
              <div className="muted">
                {KIND[task.kind] ?? task.kind}
                {task.status !== "done" ? ` · ${status?.label ?? task.status}` : ""}
                {task.duration_s !== null ? ` · ${task.duration_s.toFixed(1)} s` : ""}
                {task.cached ? " · keshdan" : ""}
              </div>
              {task.local_path !== null ? <div className="path">{task.local_path}</div> : null}
              {task.error !== null ? (
                <div className="error-text">
                  {task.error.code}: {task.error.message ?? task.error.hint}
                </div>
              ) : null}
              <div className="buttons">
                {path !== null ? (
                  <button
                    className="ghost"
                    onClick={() => setPlaying(playing === task.id ? null : task.id)}
                  >
                    {playing === task.id ? <X size={14} /> : <Play size={14} />}
                    {playing === task.id ? "Yopish" : "Eshitish"}
                  </button>
                ) : null}
                {task.status === "done" && task.kind !== "stt" && task.kind !== "align" ? (
                  <button
                    className="ghost"
                    disabled={!connected}
                    onClick={() => void act(task.id, "regenerate")}
                  >
                    <RefreshCw size={14} /> Qayta generatsiya
                  </button>
                ) : null}
                {task.status === "failed" ? (
                  <button
                    className="ghost"
                    disabled={!connected}
                    onClick={() => void act(task.id, "retry")}
                  >
                    <RotateCcw size={14} /> Qayta urinish
                  </button>
                ) : null}
              </div>
              {playing === task.id && path !== null ? (
                <audio controls autoPlay src={fileUrl(path)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
