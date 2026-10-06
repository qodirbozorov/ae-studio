import { useEffect, useState } from "react";
import type { Agent } from "../../agent";
import { aspectSize, sketchItems, slotPayload, validateSlots } from "../../agent/templates";
import type { Aspect, TemplateView } from "../../agent/templates";

/** Galereya kartasi: preview (gif) yoki manifestdan sxema. */
function Sketch({ template, aspect }: { template: TemplateView; aspect: Aspect }) {
  const { w, h } = aspectSize(aspect);
  if (template.preview_url !== null) {
    return <img src={template.preview_url} width={w} height={h} alt={template.title} />;
  }
  const items = sketchItems(template);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={template.title}>
      <rect width={w} height={h} fill="#111" />
      {items.map((item, i) => {
        const iw = item.w * w;
        const ih = item.kind === "text" ? Math.max(4, item.h * h * 1.6) : item.h * h;
        const x = item.x * w - iw / 2;
        const y = item.y * h - ih / 2;
        if (item.kind === "ellipse") {
          return (
            <ellipse
              key={i}
              cx={item.x * w}
              cy={item.y * h}
              rx={iw / 2}
              ry={ih / 2}
              fill={item.color}
              opacity={item.opacity}
            />
          );
        }
        if (item.kind === "text") {
          return (
            <text
              key={i}
              x={item.x * w}
              y={item.y * h}
              fill={item.color}
              opacity={item.opacity}
              fontSize={Math.max(4, ih * 0.8)}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {(item.text ?? "").slice(0, 24)}
            </text>
          );
        }
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={iw}
            height={ih}
            fill={item.color}
            opacity={item.opacity}
          />
        );
      })}
    </svg>
  );
}

/** Shablonlar ekrani (§11.1.5): galereya, slotlarni qo'lda to'ldirish, ishga tushirish (Claude'siz rejim). */
export function Templates({ agent, connected }: { agent: Agent; connected: boolean }) {
  const project = agent.currentProject();
  const [templates, setTemplates] = useState<TemplateView[]>([]);
  const [assets, setAssets] = useState<{ key: string; kind: string; status: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<Aspect>("9:16");
  const [extra, setExtra] = useState<Aspect[]>([]);
  const [dur, setDur] = useState<string>("");
  const [csv, setCsv] = useState<string>("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!connected) return;
    void agent
      .templates()
      .then(setTemplates)
      .catch(() => undefined);
  }, [agent, connected]);

  useEffect(() => {
    if (!connected || project === null) return;
    void agent
      .projectAssets(project.id)
      .then((list) => setAssets(list.filter((a) => a.status === "ok")))
      .catch(() => undefined);
  }, [agent, connected, project?.id]);

  const template = templates.find((t) => t.slug === selected) ?? null;

  const choose = (t: TemplateView) => {
    setSelected(t.slug);
    setValues({});
    setFormat(t.formats[0] ?? "9:16");
    setExtra([]);
    setDur(String(t.example_scene.dur));
    setCsv("");
    setMessage(null);
  };

  const run = async () => {
    if (template === null || project === null) return;
    const seconds0 = Number(dur);
    if (csv.trim() !== "") {
      // Batch: har CSV qatori — alohida video (ustun nomi = slot nomi, `name` — fayl nomi).
      setBusy(true);
      const res = await agent.runBatch({
        project_id: project.id,
        template: template.slug,
        csv,
        format,
        ...(extra.length > 0 ? { variants: extra } : {}),
        ...(Number.isFinite(seconds0) && seconds0 > 0 ? { dur: seconds0 } : {}),
      });
      setBusy(false);
      setMessage(
        res.ok
          ? { ok: true, text: `Batch boshlandi: ${res.total ?? 0} ta video navbatda` }
          : { ok: false, text: res.message ?? "Xato" },
      );
      return;
    }
    const problem = validateSlots(template, values);
    if (problem !== null) {
      setMessage({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    const seconds = Number(dur);
    const res = await agent.runTemplate(template.slug, {
      project_id: project.id,
      slots: slotPayload(template, values),
      format,
      ...(extra.length > 0 ? { variants: extra } : {}),
      ...(Number.isFinite(seconds) && seconds > 0 ? { dur: seconds } : {}),
    });
    setBusy(false);
    setMessage(
      res.ok
        ? { ok: true, text: "Job boshlandi — jarayon Live bo'limida" }
        : { ok: false, text: res.message ?? "Xato" },
    );
  };

  return (
    <section className="dev" aria-label="Shablonlar">
      <h2>Shablonlar</h2>
      {project === null ? <p className="hint">Avval ish papkasini tanlang.</p> : null}
      {connected && templates.length === 0 ? <p className="hint">Shablonlar yuklanmoqda…</p> : null}
      <div className="gallery">
        {templates.map((t) => (
          <button
            key={t.slug}
            type="button"
            className={`card${t.slug === selected ? " selected" : ""}`}
            onClick={() => choose(t)}
            title={t.description ?? t.title}
          >
            <Sketch template={t} aspect={t.formats[0] ?? "9:16"} />
            <div>
              <b>{t.title}</b>
            </div>
            <div className="muted">
              {t.formats.join(" · ")} · {t.duration.min}–{t.duration.max} s
            </div>
          </button>
        ))}
      </div>

      {template !== null ? (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <h3>{template.title}</h3>
          {template.description !== null ? <p className="muted">{template.description}</p> : null}
          {Object.entries(template.slots).map(([name, slot]) => {
            const id = `slot-${name}`;
            const value = values[name] ?? "";
            const set = (next: string) => setValues((v) => ({ ...v, [name]: next }));
            return (
              <label key={name} htmlFor={id}>
                {slot.label}
                {slot.required ? " *" : ""}
                {slot.type === "media" ? (
                  <select id={id} value={value} onChange={(e) => set(e.target.value)}>
                    <option value="">{slot.required ? "— tanlang —" : "— yo'q / default —"}</option>
                    {assets
                      .filter((a) => a.kind === "video" || a.kind === "image")
                      .map((a) => (
                        <option key={a.key} value={`asset:${a.key}`}>
                          {a.key} ({a.kind})
                        </option>
                      ))}
                  </select>
                ) : slot.type === "color" ? (
                  <input
                    id={id}
                    type="text"
                    placeholder="#RRGGBB (bo'sh — brand rangi)"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    type="text"
                    maxLength={slot.max_chars}
                    placeholder={typeof slot.default === "string" ? slot.default : ""}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </label>
            );
          })}
          <label htmlFor="tpl-format">
            Format
            <select
              id="tpl-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as Aspect)}
            >
              {template.formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Qo'shimcha formatlar</legend>
            {template.formats
              .filter((f) => f !== format)
              .map((f) => (
                <label key={f}>
                  <input
                    type="checkbox"
                    checked={extra.includes(f)}
                    onChange={(e) =>
                      setExtra((list) =>
                        e.target.checked ? [...list, f] : list.filter((x) => x !== f),
                      )
                    }
                  />{" "}
                  {f}
                </label>
              ))}
          </fieldset>
          <label htmlFor="tpl-dur">
            Davomiylik, s ({template.duration.min}–{template.duration.max})
            <input
              id="tpl-dur"
              type="number"
              min={template.duration.min}
              max={template.duration.max}
              step={0.5}
              value={dur}
              onChange={(e) => setDur(e.target.value)}
            />
          </label>
          <label htmlFor="tpl-csv">
            CSV (ixtiyoriy, batch): ustunlar — {Object.keys(template.slots).join(", ")}, name
            <textarea
              id="tpl-csv"
              rows={4}
              placeholder={`name,${Object.keys(template.slots).join(",")}`}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          {message !== null ? (
            <p className={message.ok ? "hint" : "error-text"}>{message.text}</p>
          ) : null}
          <div className="buttons">
            <button type="submit" disabled={!connected || project === null || busy}>
              {busy ? "Yuborilmoqda…" : "Videoni yaratish"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
