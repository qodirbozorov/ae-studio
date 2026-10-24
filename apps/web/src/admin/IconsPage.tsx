/** Admin → Ikonkalar: WorldVectorLogo API kaliti (shifrlangan, faqat admin), kreditlar va manbalar. */
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

interface WvlView {
  configured: boolean;
  masked: string | null;
  updated_at: string | null;
  usage: {
    plan: string;
    plan_remaining: number;
    addon_remaining: number;
    monthly_allowance: number;
    resets_at: string | null;
    daily: { date: string; requests: number; errors: number }[];
  } | null;
  error: { code: string; message: string | null } | null;
  cached_logos: number;
}

const num = (value: number) => value.toLocaleString("uz-UZ").replace(/,/g, " ");

function KeyCard({ view, onChange }: { view: WvlView; onChange: (v: WvlView) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await api<WvlView>("/api/admin/worldvectorlogo", {
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
        "WorldVectorLogo kaliti o'chirilsinmi? Logolar kalitsiz olinadi (kuniga 10 so'rov); saqlangan logolar ishlayveradi.",
      )
    )
      return;
    const res = await api<WvlView>("/api/admin/worldvectorlogo", { method: "DELETE" });
    if (res.ok) onChange(res.data);
    else setMessage({ ok: false, text: res.error.message ?? res.error.hint });
  };

  return (
    <Card>
      <CardTitle
        aside={
          !view.configured ? (
            <Pill tone="wait">Kalitsiz (10/kun)</Pill>
          ) : view.error !== null ? (
            <Pill tone="stop">Xato: {view.error.code}</Pill>
          ) : (
            <Pill tone="go" dot>
              Ulangan
            </Pill>
          )
        }
      >
        WorldVectorLogo kaliti
      </CardTitle>
      <p className="max-w-[65ch] text-[0.95rem] leading-relaxed text-ink-3">
        Brend logolari (SVG) — <code>wvl:&lt;slug&gt;</code>. Kalit:{" "}
        <a href="https://worldvectorlogo.com/account/api-keys" target="_blank" rel="noreferrer">
          worldvectorlogo.com → Account → API Keys
        </a>
        . Saqlashdan oldin tekshiriladi, serverda AES-256-GCM bilan shifrlanadi va qaytarib
        ko'rsatilmaydi.
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
        <Field label={view.configured ? "Yangi kalit" : "Kalit"} htmlFor="wvl-key">
          <input
            id="wvl-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            className={inputClass}
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || key.trim().length < 8}>
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

function CreditsCard({ view }: { view: WvlView }) {
  const u = view.usage;
  if (u === null) {
    return (
      <Card>
        <CardTitle>Kreditlar</CardTitle>
        <Empty>
          {view.configured
            ? "Hisob ma'lumotini olib bo'lmadi."
            : "Kalit kiritilgach oylik kredit va sarf shu yerda ko'rinadi."}
        </Empty>
      </Card>
    );
  }
  const remaining = u.plan_remaining + u.addon_remaining;
  const used =
    u.monthly_allowance > 0 ? Math.min(1, 1 - u.plan_remaining / u.monthly_allowance) : 0;
  const low = u.monthly_allowance > 0 && u.plan_remaining / u.monthly_allowance < 0.1;
  return (
    <Card>
      <CardTitle aside={<Pill tone={low ? "stop" : "go"}>{u.plan}</Pill>}>Kreditlar</CardTitle>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <Label>Qolgan</Label>
          <div className="mt-3">
            <Figure value={num(remaining)} />
          </div>
          {u.addon_remaining > 0 ? (
            <span className="mt-1 block text-sm text-ink-3">
              shundan qo'shimcha: {num(u.addon_remaining)}
            </span>
          ) : null}
        </div>
        <div className="min-w-0">
          <Label>Oylik</Label>
          <div className="mt-3">
            <Figure value={num(u.monthly_allowance)} />
          </div>
          {u.resets_at !== null ? (
            <span className="mt-1 block text-sm text-ink-3">yangilanadi: {day(u.resets_at)}</span>
          ) : null}
        </div>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${low ? "bg-stop" : "bg-ink"}`}
          style={{ width: `${Math.round(used * 100)}%` }}
        />
      </div>
      <p className="mt-4 text-sm text-ink-3">
        {Math.round(used * 100)}% ishlatilgan · serverda saqlangan logolar qayta kredit sarflamaydi
        {view.cached_logos > 0 ? ` (bu jarayonda ${view.cached_logos} ta)` : ""}
      </p>
      {low ? <p className="mt-1 text-sm text-stop">Kredit 10% dan kam qoldi.</p> : null}
      {u.daily.length > 0 ? (
        <ul className="mt-5 divide-y divide-hair">
          <li className="grid grid-cols-[1fr_6rem_5rem] py-2 text-sm text-ink-3">
            <span>Kun</span>
            <span className="text-right">So'rov</span>
            <span className="text-right">Xato</span>
          </li>
          {u.daily.map((row) => (
            <li key={row.date} className="grid grid-cols-[1fr_6rem_5rem] py-2 text-[0.95rem]">
              <span>{day(row.date)}</span>
              <span className="num text-right">{num(row.requests)}</span>
              <span className={`num text-right ${row.errors > 0 ? "text-stop" : "text-ink-3"}`}>
                {num(row.errors)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function SourcesCard() {
  const rows = [
    { name: "Lucide", note: "~1 900 chiziqli UI ikonka, serverda (internetsiz) — sukut bo'yicha" },
    {
      name: "Iconify",
      note: "200 000+ ikonka, 150+ to'plam (mdi, tabler, ph, simple-icons, logos, flag …) — bepul",
    },
    {
      name: "WorldVectorLogo",
      note: "Brend logolari — faqat Claude aniq so'raganda (har qidiruv va yangi logo 1 kredit)",
    },
  ];
  return (
    <Card>
      <CardTitle>Manbalar</CardTitle>
      <ul className="divide-y divide-hair">
        {rows.map((row) => (
          <li key={row.name} className="grid gap-1 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <span className="text-[1.02rem]">{row.name}</span>
            <span className="text-[0.95rem] text-ink-3">{row.note}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-ink-3">
        Ikonka AE'ga tiniq vektor sifatida aniq o'lchamda va markazda tushadi;{" "}
        <code>as_shapes</code> — geometriyadan native shape qatlam (gradient/maskali logolar vektor
        footage bo'lib qoladi).
      </p>
    </Card>
  );
}

export function IconsPage() {
  const [view, setView] = useState<WvlView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    const res = await api<WvlView>(`/api/admin/worldvectorlogo${fresh ? "?fresh=1" : ""}`);
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
        title="Ikonkalar"
        muted="va logolar"
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
            <CreditsCard view={view} />
          </div>
          <SourcesCard />
        </div>
      ) : null}
    </>
  );
}
