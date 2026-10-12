/** Admin → Musiqa kutubxonasi: yuklash (ko'p fayl), tahrir, nomzodlarni ko'rib chiqish. */
import { Check, EyeOff, Music, Pause, Pencil, Play, Search, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Count,
  Empty,
  Loading,
  Notice,
  PageTitle,
  Pill,
  Segmented,
  cx,
  inputClass,
} from "../ui";
import type { Tone } from "../ui";

type Status = "candidate" | "public" | "hidden";

interface Track {
  id: string;
  title: string;
  category: string;
  description: string;
  tags: string[];
  duration_s: number;
  bpm: number | null;
  loopable: boolean;
  status: Status;
  source: "seed" | "admin" | "generated";
  prompt: string | null;
  owner: string | null;
}

interface Draft {
  file: File;
  title: string;
  category: string;
  description: string;
  tags: string;
  loopable: boolean;
  duration: number | null;
  state: "ready" | "uploading" | "done" | "error";
  error?: string;
}

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  candidate: { label: "Nomzod", tone: "wait" },
  public: { label: "Ommaviy", tone: "go" },
  hidden: { label: "Yashirin", tone: "neutral" },
};

const SOURCE: Record<Track["source"], string> = {
  seed: "seed",
  admin: "admin",
  generated: "generatsiya",
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Brauzerda audio uzunligi (metadata). */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    audio.src = url;
  });
}

const tagsOf = (text: string) =>
  text
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);

function Uploader({ onDone }: { onDone: () => void }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
    if (files === null) return;
    const next: Draft[] = [];
    for (const file of Array.from(files)) {
      next.push({
        file,
        title: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
        category: "",
        description: "",
        tags: "",
        loopable: false,
        duration: await readDuration(file),
        state: "ready",
      });
    }
    setDrafts((d) => [...d, ...next]);
  };

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const upload = async () => {
    setBusy(true);
    for (const [i, draft] of drafts.entries()) {
      if (draft.state === "done") continue;
      const cat = draft.category.trim() || category.trim();
      if (cat === "" || draft.duration === null) {
        update(i, { state: "error", error: cat === "" ? "Kategoriya kerak" : "Uzunlik o'qilmadi" });
        continue;
      }
      update(i, { state: "uploading", error: undefined });
      const meta = {
        filename: draft.file.name,
        title: draft.title.trim() || draft.file.name,
        category: cat,
        description: draft.description.trim(),
        tags: tagsOf(draft.tags),
        duration_s: Math.round(draft.duration * 100) / 100,
        loopable: draft.loopable,
        status: "public",
      };
      try {
        const res = await fetch(
          `/api/admin/music?meta=${encodeURIComponent(JSON.stringify(meta))}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": draft.file.type || "application/octet-stream" },
            body: draft.file,
          },
        );
        const json = (await res.json()) as {
          ok: boolean;
          error?: { message?: string; hint?: string };
        };
        update(
          i,
          json.ok
            ? { state: "done" }
            : { state: "error", error: json.error?.message ?? json.error?.hint },
        );
      } catch {
        update(i, { state: "error", error: "Tarmoq xatosi" });
      }
    }
    setBusy(false);
    onDone();
  };

  const pending = drafts.filter((d) => d.state !== "done").length;

  return (
    <Card>
      <CardTitle
        aside={
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
            <Upload /> Fayllarni tanlash
          </Button>
        }
      >
        Yuklash
      </CardTitle>
      <input
        ref={input}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
        multiple
        hidden
        onChange={(e) => {
          void pick(e.target.files);
          e.target.value = "";
        }}
      />
      {drafts.length === 0 ? (
        <p className="text-[0.95rem] text-ink-3">
          mp3, wav, m4a yoki ogg — bir nechtasini birdaniga tanlang. Izohni AI qidiruvi uchun
          yozing: kayfiyat, janr, cholg'ular, temp (masalan: «tinch pianino, iliq, korporativ»).
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label htmlFor="bulk-cat" className="text-sm text-ink-2">
              Umumiy kategoriya
            </label>
            <input
              id="bulk-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="masalan: corporate"
              className={cx(inputClass, "max-w-[16rem] py-2")}
            />
          </div>
          <ul className="grid gap-3">
            {drafts.map((d, i) => (
              <li
                key={`${d.file.name}-${i}`}
                className="grid gap-2 rounded-[1.1rem] bg-white p-4 shadow-raise"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[0.85rem]">{d.file.name}</span>
                  <span className="flex items-center gap-2 text-sm text-ink-3">
                    {d.duration !== null ? mmss(d.duration) : "?"}
                    {d.state === "done" ? <Pill tone="go">Yuklandi</Pill> : null}
                    {d.state === "uploading" ? (
                      <Pill tone="live" dot>
                        Yuklanmoqda
                      </Pill>
                    ) : null}
                    {d.state === "error" ? <Pill tone="stop">{d.error ?? "Xato"}</Pill> : null}
                    {d.state !== "done" ? (
                      <button
                        type="button"
                        aria-label="Olib tashlash"
                        onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[0.7rem] hover:bg-well"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </span>
                </div>
                {d.state !== "done" ? (
                  <div className="grid gap-2 md:grid-cols-[1.2fr_0.8fr_2fr_1fr_auto]">
                    <input
                      aria-label="Nomi"
                      value={d.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      placeholder="Nomi"
                      className={cx(inputClass, "py-2")}
                    />
                    <input
                      aria-label="Kategoriya"
                      value={d.category}
                      onChange={(e) => update(i, { category: e.target.value })}
                      placeholder={category || "Kategoriya"}
                      className={cx(inputClass, "py-2")}
                    />
                    <input
                      aria-label="Izoh"
                      value={d.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                      placeholder="Izoh (kayfiyat, janr, cholg'u)"
                      className={cx(inputClass, "py-2")}
                    />
                    <input
                      aria-label="Teglar"
                      value={d.tags}
                      onChange={(e) => update(i, { tags: e.target.value })}
                      placeholder="teglar, vergul bilan"
                      className={cx(inputClass, "py-2")}
                    />
                    <label className="flex items-center gap-2 text-sm whitespace-nowrap text-ink-2">
                      <input
                        type="checkbox"
                        checked={d.loopable}
                        onChange={(e) => update(i, { loopable: e.target.checked })}
                        className="h-4 w-4 accent-ink"
                      />
                      Loop
                    </label>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={busy || pending === 0} onClick={() => void upload()}>
              <Upload /> {busy ? "Yuklanmoqda…" : `Yuklash (${pending})`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDrafts((d) => d.filter((x) => x.state !== "done"))}
            >
              Tayyorlarini tozalash
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function TrackRow({ track, onChange }: { track: Track; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: track.title,
    category: track.category,
    description: track.description,
    tags: track.tags.join(", "),
    loopable: track.loopable,
  });
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    const res = await api(`/api/admin/music/${track.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setEditing(false);
      onChange();
    } else setError(res.error.message ?? res.error.hint);
  };

  const remove = async () => {
    if (!window.confirm(`O'chirilsinmi? «${track.title}» (fayl ham o'chadi)`)) return;
    const res = await api(`/api/admin/music/${track.id}`, { method: "DELETE" });
    if (res.ok) onChange();
    else setError(res.error.message ?? res.error.hint);
  };

  const toggle = () => {
    const el = audio.current;
    if (el === null) return;
    if (playing) el.pause();
    else void el.play();
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "To'xtatish" : "Tinglash"}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-well text-ink-2 hover:text-ink"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <audio
          ref={audio}
          preload="none"
          src={`/api/admin/music/${track.id}/file`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.02rem] font-normal">{track.title}</span>
            <Pill tone={STATUS[track.status].tone}>{STATUS[track.status].label}</Pill>
            {track.loopable ? <Pill>loop</Pill> : null}
          </div>
          <div className="num mt-0.5 text-sm text-ink-3">
            {track.category} · {mmss(track.duration_s)}
            {track.bpm !== null ? ` · ${track.bpm} BPM` : ""} · {SOURCE[track.source]}
            {track.owner !== null ? ` · ${track.owner}` : ""}
          </div>
          {track.description !== "" ? (
            <div className="mt-1 max-w-[70ch] text-sm text-ink-2">{track.description}</div>
          ) : null}
          {track.prompt !== null && track.prompt !== track.description ? (
            <div className="mt-1 max-w-[70ch] text-xs text-ink-3">Prompt: {track.prompt}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {track.status !== "public" ? (
            <Button size="sm" variant="secondary" onClick={() => void save({ status: "public" })}>
              <Check /> Ommaviy
            </Button>
          ) : null}
          {track.status !== "hidden" ? (
            <Button size="sm" variant="ghost" onClick={() => void save({ status: "hidden" })}>
              <EyeOff /> Yashirish
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing((v) => !v)}
            aria-label="Tahrirlash"
          >
            <Pencil />
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove()} aria-label="O'chirish">
            <Trash2 />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="mt-3 grid gap-2 md:grid-cols-[1.2fr_0.8fr_2fr_1fr_auto_auto] md:pl-[3.25rem]">
          <input
            aria-label="Nomi"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={cx(inputClass, "py-2")}
          />
          <input
            aria-label="Kategoriya"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className={cx(inputClass, "py-2")}
          />
          <input
            aria-label="Izoh"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className={cx(inputClass, "py-2")}
          />
          <input
            aria-label="Teglar"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className={cx(inputClass, "py-2")}
          />
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={form.loopable}
              onChange={(e) => setForm({ ...form, loopable: e.target.checked })}
              className="h-4 w-4 accent-ink"
            />
            Loop
          </label>
          <Button
            size="sm"
            onClick={() =>
              void save({
                title: form.title,
                category: form.category,
                description: form.description,
                tags: tagsOf(form.tags),
                loopable: form.loopable,
              })
            }
          >
            Saqlash
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <div className="mt-2 md:pl-[3.25rem]">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
    </li>
  );
}

export function MusicPage() {
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{
    tracks: Track[];
    counts: Partial<Record<Status, number>>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (query.trim() !== "") params.set("q", query.trim());
    const res = await api<{ tracks: Track[]; counts: Partial<Record<Status, number>> }>(
      `/api/admin/music?${params.toString()}`,
    );
    if (res.ok) setData(res.data);
    else setError(res.error.message ?? res.error.hint);
  }, [filter, query]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const counts = data?.counts ?? {};
  const candidates = counts.candidate ?? 0;

  return (
    <>
      <PageTitle title="Musiqa" muted="kutubxonasi" />
      <div className="grid grid-cols-1 gap-6">
        <Uploader onDone={() => void load()} />
        <Card>
          <CardTitle
            aside={
              <Segmented
                options={[
                  { key: "all", label: "Hammasi" },
                  { key: "candidate", label: `Nomzodlar${candidates > 0 ? ` ${candidates}` : ""}` },
                  { key: "public", label: "Ommaviy" },
                  { key: "hidden", label: "Yashirin" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            }
          >
            <span className="flex items-center gap-3">
              Treklar
              {candidates > 0 ? <Count tone="peach">{candidates}</Count> : null}
            </span>
          </CardTitle>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-4" />
            <input
              aria-label="Qidirish"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom, kategoriya yoki izoh bo'yicha"
              className={cx(inputClass, "py-2.5 pl-10")}
            />
          </div>
          {error !== null ? (
            <div className="mt-4">
              <Notice ok={false}>{error}</Notice>
            </div>
          ) : null}
          {data === null ? <Loading /> : null}
          {data !== null && data.tracks.length === 0 ? (
            <Empty>
              <Music className="mx-auto mb-2 h-6 w-6 text-ink-4" />
              Trek yo'q. Yuqorida fayl yuklang yoki{" "}
              <code>pnpm --filter @aes/server seed:music</code>.
            </Empty>
          ) : null}
          {data !== null ? (
            <ul className="mt-2 divide-y divide-hair">
              {data.tracks.map((track) => (
                <TrackRow
                  key={`${track.id}-${track.status}-${track.title}`}
                  track={track}
                  onChange={() => void load()}
                />
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </>
  );
}
