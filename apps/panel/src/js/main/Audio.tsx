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

const STATUS: Record<string, string> = {
  queued: "⏳ navbatda",
  running: "⚙️ ishlanmoqda",
  done: "✅",
  failed: "❌",
  skipped: "⏭ o'tkazildi",
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
          return (
            <li key={task.id}>
              <div>
                {STATUS[task.status] ?? task.status}{" "}
                <b>{task.label ?? KIND[task.kind] ?? task.kind}</b>{" "}
                <span className="muted">
                  {KIND[task.kind] ?? task.kind}
                  {task.duration_s !== null ? ` · ${task.duration_s.toFixed(1)} s` : ""}
                  {task.cached ? " · keshdan" : ""}
                </span>
              </div>
              {task.local_path !== null ? <div className="muted">{task.local_path}</div> : null}
              {task.error !== null ? (
                <div className="error-text">
                  {task.error.code}: {task.error.message ?? task.error.hint}
                </div>
              ) : null}
              <div className="buttons">
                {path !== null ? (
                  <button
                    className="link-button"
                    onClick={() => setPlaying(playing === task.id ? null : task.id)}
                  >
                    {playing === task.id ? "Yopish" : "▶ Eshitish"}
                  </button>
                ) : null}
                {task.status === "done" && task.kind !== "stt" && task.kind !== "align" ? (
                  <button
                    className="link-button"
                    disabled={!connected}
                    onClick={() => void act(task.id, "regenerate")}
                  >
                    Qayta generatsiya
                  </button>
                ) : null}
                {task.status === "failed" ? (
                  <button
                    className="link-button"
                    disabled={!connected}
                    onClick={() => void act(task.id, "retry")}
                  >
                    Qayta urinish
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
