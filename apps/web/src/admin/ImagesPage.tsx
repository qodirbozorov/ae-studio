/** Admin → Rasmlar: Unsplash Access Key (shifrlangan, faqat admin), soatlik limit va loyihalarga olingan rasmlar. */
import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Empty,
  Field,
  Figure,
  Label,
  Loading,
  Notice,
  PageTitle,
  Pill,
  Spinner,
  day,
  inputClass,
  when,
} from "../ui";

interface ImagesView {
  configured: boolean;
  masked: string | null;
  updated_at: string | null;
  rate: { limit: number | null; remaining: number | null; at: string } | null;
  error: { code: string; message: string | null } | null;
  stats: {
    total: number;
    last_30d: number;
    untracked: number;
    recent: { photo_id: string; author: string; photo_url: string; created_at: string }[];
  };
}

const num = (value: number) => value.toLocaleString("uz-UZ").replace(/,/g, " ");

function KeyCard({ view, onChange }: { view: ImagesView; onChange: (v: ImagesView) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await api<ImagesView>("/api/admin/unsplash", {
      method: "PUT",
      body: JSON.stringify({ api_key: key }),
    });
    setBusy(false);
    if (res.ok) {
      setKey("");
      onChange(res.data);
      setMessage({ ok: true, text: "Kalit tekshirildi va shifrlab saqlandi" });
    } else {
      setMessage({ ok: false, text: res.error.message ?? res.error.hint });
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        "Unsplash kaliti o'chirilsinmi? Claude rasm qidira olmaydi; loyihalarga olingan rasmlar qoladi.",
      )
    ) {
      return;
    }
    const res = await api<ImagesView>("/api/admin/unsplash", { method: "DELETE" });
    if (res.ok) onChange(res.data);
    else setMessage({ ok: false, text: res.error.message ?? res.error.hint });
  };

  return (
    <Card>
      <CardTitle
        aside={
          !view.configured ? (
            <Pill tone="wait">Sozlanmagan</Pill>
          ) : view.error !== null ? (
            <Pill tone="stop">Xato: {view.error.code}</Pill>
          ) : (
            <Pill tone="go" dot>
              Ulangan
            </Pill>
          )
        }
      >
        Unsplash kaliti
      </CardTitle>
      <p className="max-w-[65ch] text-[0.95rem] leading-relaxed text-ink-3">
        Videolar uchun foto qidirish. Kalit:{" "}
        <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noreferrer">
          unsplash.com → Your apps
        </a>{" "}
        → <b>Access Key</b>. Saqlashdan oldin tekshiriladi, serverda AES-256-GCM bilan shifrlanadi.
        Rasm fayllari foydalanuvchi kompyuteriga to'g'ridan-to'g'ri Unsplash CDN'dan tushadi —
        serverda saqlanmaydi.
      </p>
      <div className="mt-5 grid gap-1 text-[0.95rem]">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 text-ink-4" />
          <span>{view.masked ?? "—"}</span>
          {view.updated_at !== null && view.configured ? (
            <span className="text-ink-3">· {when(view.updated_at)}</span>
          ) : null}
        </div>
        {view.error !== null ? (
          <span className="text-sm text-stop">{view.error.message ?? view.error.code}</span>
        ) : null}
      </div>
      <form onSubmit={(e) => void save(e)} className="mt-6 grid gap-4">
        <Field label={view.configured ? "Yangi Access Key" : "Access Key"} htmlFor="unsplash-key">
          <input
            id="unsplash-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            className={inputClass}
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || key.trim().length < 20}>
            <Save /> {busy ? "Tekshirilmoqda…" : "Tekshirish va saqlash"}
          </Button>
          {view.configured ? (
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 /> O'chirish
            </Button>
          ) : null}
        </div>
        {message !== null ? <Notice ok={message.ok}>{message.text}</Notice> : null}
      </form>
    </Card>
  );
}

function QuotaCard({ view }: { view: ImagesView }) {
  const r = view.rate;
  const used = r?.limit ? Math.min(1, 1 - (r.remaining ?? 0) / r.limit) : 0;
  const demo = r?.limit !== null && r?.limit !== undefined && r.limit <= 50;
  return (
    <Card>
      <CardTitle
        aside={r ? <Pill tone={demo ? "wait" : "go"}>{demo ? "demo" : "production"}</Pill> : null}
      >
        Soatlik limit
      </CardTitle>
      {r === null ? (
        <Empty>Kalit kiritilgach Unsplash limiti shu yerda ko'rinadi.</Empty>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="min-w-0">
              <Label>Qolgan so'rov</Label>
              <div className="mt-3">
                <Figure value={num(r.remaining ?? 0)} />
              </div>
              <span className="mt-1 block text-sm text-ink-3">{num(r.limit ?? 0)} / soat</span>
            </div>
            <div className="min-w-0">
              <Label>Loyihalarga olingan</Label>
              <div className="mt-3">
                <Figure value={num(view.stats.total)} />
              </div>
              <span className="mt-1 block text-sm text-ink-3">
                30 kunda: {num(view.stats.last_30d)}
              </span>
            </div>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
            <div
              className="h-full rounded-full bg-ink transition-[width] duration-500"
              style={{ width: `${Math.round(used * 100)}%` }}
            />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink-3">
            Oxirgi tekshiruv: {when(r.at)}. Rasm fayllari limitga kirmaydi; qidiruv natijalari 1
            soat keshlanadi.
            {demo
              ? " Demo rejim — soatiga 50 so'rov: production uchun Unsplash'ga ariza bering."
              : ""}
          </p>
          {view.stats.untracked > 0 ? (
            <p className="mt-1 text-sm text-stop">
              Download tracking yuborilmagan: {view.stats.untracked}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

function RecentCard({ view }: { view: ImagesView }) {
  return (
    <Card>
      <CardTitle>Oxirgi rasmlar</CardTitle>
      {view.stats.recent.length === 0 ? (
        <Empty>Hali loyihalarga rasm olinmagan.</Empty>
      ) : (
        <ul className="divide-y divide-hair">
          {view.stats.recent.map((row) => (
            <li
              key={`${row.photo_id}${row.created_at}`}
              className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center"
            >
              <span className="min-w-0 truncate text-[1.02rem]">
                Photo by {row.author} on{" "}
                <a href={row.photo_url} target="_blank" rel="noreferrer">
                  Unsplash
                </a>
              </span>
              <span className="text-sm text-ink-3 sm:text-right">{day(row.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-ink-3">
        Claude rasmni foydalanuvchiga ko'rsatib, tanlovdan keyin loyihaning{" "}
        <code>source/unsplash/</code> papkasiga oladi; nashr uchun mualliflar ro'yxati —{" "}
        <code>images_credits</code>.
      </p>
    </Card>
  );
}

export function ImagesPage() {
  const [view, setView] = useState<ImagesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    const res = await api<ImagesView>(`/api/admin/unsplash${fresh ? "?fresh=1" : ""}`);
    setRefreshing(false);
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else {
      setError(res.error.message ?? res.error.hint);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageTitle
        title="Rasmlar"
        muted="Unsplash"
        action={
          <Button
            variant="secondary"
            size="sm"
            disabled={refreshing}
            onClick={() => void load(true)}
          >
            {refreshing ? <Spinner className="h-4 w-4" /> : <RefreshCw />} Yangilash
          </Button>
        }
      />
      {error !== null ? <Notice ok={false}>{error}</Notice> : null}
      {view === null && error === null ? <Loading /> : null}
      {view !== null ? (
        <div className="grid grid-cols-1 gap-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <KeyCard view={view} onChange={setView} />
            <QuotaCard view={view} />
          </div>
          <RecentCard view={view} />
        </div>
      ) : null}
    </>
  );
}
