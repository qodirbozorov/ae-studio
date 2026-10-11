import { Folder, FolderCheck, FolderOpen, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent, PanelSettings, ProjectInfo } from "../../agent";

/** CEP papka tanlash dialogi; CEP tashqarisida null. */
function chooseFolder(): string | null {
  const result = window.cep?.fs.showOpenDialogEx(false, true, "Ish papkasini tanlang", "", []);
  return result !== undefined && result.err === 0 && result.data.length > 0
    ? (result.data[0] ?? null)
    : null;
}

/** "Ish papkasi" ekrani (§11.1.2): tanlash va oxirgi loyihalar. */
export function Workspace({ agent, connected }: { agent: Agent; connected: boolean }) {
  const [current, setCurrent] = useState<ProjectInfo | null>(agent.currentProject());
  const [recent, setRecent] = useState<ProjectInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (connected) void agent.recentProjects().then(setRecent, () => setRecent([]));
  }, [agent, connected, current]);

  const open = async (folder: string | null) => {
    if (folder === null) return;
    setError(null);
    try {
      setCurrent(await agent.openProject(folder));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="dev">
      <h2>Ish papkasi</h2>
      {current !== null ? (
        <div className="project-row current">
          <FolderCheck size={16} className="ok-icon" />
          <div className="project-text">
            <b>{current.name}</b>
            <span className="path">{current.root_path}</span>
          </div>
        </div>
      ) : (
        <p className="hint">
          Papka tanlanmagan: AE oplari fayllarni faqat shu papka ichidan oladi.
        </p>
      )}
      <div className="buttons">
        <button disabled={!connected} onClick={() => void open(chooseFolder())}>
          <FolderOpen size={15} /> Papka tanlash
        </button>
        <button
          disabled={!connected || current === null || scanning}
          onClick={() => {
            setScanning(true);
            setError(null);
            agent
              .scanAssets()
              .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setScanning(false));
          }}
        >
          <ScanSearch size={15} className={scanning ? "spin" : undefined} />
          {scanning ? "Skanerlanmoqda…" : "Skanerlash"}
        </button>
      </div>
      {recent.length > 0 ? (
        <ul className="recent projects">
          {recent
            .filter((p) => p.id !== current?.id)
            .slice(0, 5)
            .map((p) => (
              <li key={p.id}>
                <button
                  className="project-row"
                  disabled={!connected}
                  title={`Ochish: ${p.root_path}`}
                  onClick={() => void open(p.root_path)}
                >
                  <Folder size={16} />
                  <span className="project-text">
                    <b>{p.name}</b>
                    <span className="path">{p.root_path}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      {error ? <p className="hint error-text">{error}</p> : null}
    </section>
  );
}

/** "Sozlamalar" (§11.1.7): qurilma nomi, log darajasi. */
export function Settings({
  agent,
  onChange,
}: {
  agent: Agent;
  onChange: (settings: PanelSettings) => void;
}) {
  const [settings, setSettings] = useState(agent.settings());
  const update = (next: Partial<PanelSettings>) => {
    const saved = agent.updateSettings(next);
    setSettings(saved);
    onChange(saved);
  };
  return (
    <section className="dev">
      <h2>Sozlamalar</h2>
      <div className="form">
        <label className="hint" htmlFor="device-name">
          Qurilma nomi (keyingi ulanishda)
        </label>
        <input
          id="device-name"
          defaultValue={settings.device_name ?? ""}
          placeholder="Masalan: Studio-PC"
          onBlur={(e) => update({ device_name: e.target.value.trim() || null })}
        />
        <label className="hint" htmlFor="log-level">
          Log darajasi
        </label>
        <select
          id="log-level"
          value={settings.log_level}
          onChange={(e) => update({ log_level: e.target.value as PanelSettings["log_level"] })}
        >
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </div>
    </section>
  );
}
