/** Admin → Audio: markaziy ElevenLabs kaliti (shifrlangan, faqat admin), kvota, qolgan kredit va sarf. */
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

interface AudioView {
  source: "db" | "env" | "none";
  masked: string | null;
  env_key: boolean;
  updated_at: string | null;
  updated_by: string | null;
  account: {
    tier: string;
    status: string;
    character_count: number;
    character_limit: number;
    remaining: number;
    next_reset: string | null;
    voice_limit: number | null;
    voice_slots_used: number | null;
    can_clone: boolean | null;
    billing_period: string | null;
  } | null;
  error: { code: string; message: string | null } | null;
  usage: {
    since: string;
    items: {
      item: string;
      unit: string;
      count: number;
      quantity: number;
      cached: number;
      cost_usd: number;
      charged_usd: number;
    }[];
    total_cost_usd: number;
    total_charged_usd: number;
  };
}

const ITEM_LABEL: Record<string, string> = {
  tts: "Ovoz (TTS)",
  voice_design: "Ovoz dizayni",
  dialogue: "Dialog",
  music: "Musiqa",
  sfx: "Effekt tovushlari",
  stt: "Transkripsiya",
  align: "Matn moslash",
  isolate: "Ovozni ajratish",
  voice_change: "Ovoz almashtirish",
  dub: "Dublyaj",
};

const UNIT_LABEL: Record<string, string> = {
  chars: "belgi",
  seconds: "s",
  minutes: "daq",
  usd: "$",
};

function itemLabel(item: string): string {
  const [kind, tier] = item.split(".");
  const label = ITEM_LABEL[kind!] ?? item;
  return tier === undefined ? label : `${label} · ${tier}`;
}

const num = (value: number) => value.toLocaleString("uz-UZ").replace(/,/g, " ");
const usd = (value: number) => `$${value.toFixed(2)}`;

const SOURCE_LABEL: Record<AudioView["source"], string> = {
  db: "Admin paneldan (shifrlangan)",
  env: "Env'dan (ELEVENLABS_API_KEY)",
  none: "Kalit yo'q",
};

function KeyCard({ view, onChange }: { view: AudioView; onChange: (v: AudioView) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await api<AudioView>("/api/admin/elevenlabs", {
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
    const fallback = view.env_key
      ? "Env'dagi kalit (ELEVENLABS_API_KEY) ishlatiladi."
      : "Audio xizmati to'xtaydi — barcha foydalanuvchilarda.";
    if (!window.confirm(`Admin paneldagi kalit o'chirilsinmi? ${fallback}`)) return;
    const res = await api<AudioView>("/api/admin/elevenlabs", { method: "DELETE" });
    if (res.ok) onChange(res.data);
    else setMessage({ ok: false, text: res.error.message ?? res.error.hint });
  };

  return (
    <Card>
      <CardTitle
        aside={
          view.source === "none" ? (
            <Pill tone="stop">Sozlanmagan</Pill>
          ) : view.error !== null ? (
            <Pill tone="stop">Xato: {view.error.code}</Pill>
          ) : (
            <Pill tone="go" dot>
              Ulangan
            </Pill>
          )
        }
      >
        ElevenLabs kaliti
      </CardTitle>
      <p className="max-w-[65ch] text-[0.95rem] leading-relaxed text-ink-3">
        Bitta markaziy kalit — barcha foydalanuvchilarning audio so'rovlari shu hisobdan. Kalit
        saqlashdan oldin tekshiriladi, serverda AES-256-GCM bilan shifrlanadi va qaytarib
        ko'rsatilmaydi.
      </p>
      <div className="mt-5 grid gap-1 text-[0.95rem]">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="h-4 w-4 text-ink-4" />
          <span>{view.masked ?? "—"}</span>
          <span className="text-ink-3">· {SOURCE_LABEL[view.source]}</span>
        </div>
        {view.updated_at !== null ? (
          <span className="text-sm text-ink-3">
            O'zgartirilgan: {when(view.updated_at)}
            {view.updated_by === "env" ? " (env'dan ko'chirilgan)" : ""}
          </span>
        ) : null}
        {view.error !== null ? (
          <span className="text-sm text-stop">{view.error.message ?? view.error.code}</span>
        ) : null}
      </div>
      <form onSubmit={(e) => void save(e)} className="mt-6 grid gap-4">
        <Field label={view.source === "db" ? "Yangi kalit" : "Kalit"} htmlFor="el-key">
          <input
            id="el-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            placeholder="sk_…"
            className={inputClass}
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || key.trim().length < 10}>
            <Save /> {busy ? "Tekshirilmoqda…" : "Tekshirish va saqlash"}
          </Button>
          {view.source === "db" ? (
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

function QuotaCard({ view }: { view: AudioView }) {
  const a = view.account;
  if (a === null) {
    return (
      <Card>
        <CardTitle>Kvota</CardTitle>
        <Empty>
          {view.source === "none"
            ? "Kalit kiritilgach obuna va kvota shu yerda ko'rinadi."
            : "Obuna ma'lumotini olib bo'lmadi."}
        </Empty>
      </Card>
    );
  }
  const used = a.character_limit > 0 ? Math.min(1, a.character_count / a.character_limit) : 0;
  const low = a.character_limit > 0 && a.remaining / a.character_limit < 0.1;
  return (
    <Card>
      <CardTitle
        aside={
          <Pill tone={a.status === "active" ? "go" : "wait"}>
            {a.tier} · {a.status}
          </Pill>
        }
      >
        Kvota
      </CardTitle>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="min-w-0">
          <Label>Qolgan kredit</Label>
          <div className="mt-3">
            <Figure value={num(a.remaining)} />
          </div>
        </div>
        <div className="min-w-0">
          <Label>Sarflangan</Label>
          <div className="mt-3">
            <Figure value={num(a.character_count)} />
          </div>
          <span className="mt-1 block text-sm text-ink-3">{num(a.character_limit)} limitdan</span>
        </div>
      </div>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${low ? "bg-stop" : "bg-ink"}`}
          style={{ width: `${Math.round(used * 100)}%` }}
        />
      </div>
      <div className="mt-4 grid gap-1 text-sm text-ink-3">
        <span>
          {Math.round(used * 100)}% ishlatilgan
          {a.next_reset !== null ? ` · yangilanadi: ${day(a.next_reset)}` : ""}
          {a.billing_period !== null ? ` · to'lov davri: ${a.billing_period}` : ""}
        </span>
        <span>
          Ovoz slotlari:{" "}
          {a.voice_slots_used !== null
            ? `${a.voice_slots_used} / ${a.voice_limit ?? "—"}`
            : (a.voice_limit ?? "—")}
          {a.can_clone !== null ? ` · klonlash: ${a.can_clone ? "bor" : "yo'q"}` : ""}
        </span>
        {low ? <span className="text-stop">Kredit 10% dan kam qoldi.</span> : null}
      </div>
    </Card>
  );
}

function UsageCard({ view }: { view: AudioView }) {
  const { usage } = view;
  return (
    <Card>
      <CardTitle
        aside={
          <span className="text-sm text-ink-3">
            {day(usage.since)} dan · tannarx {usd(usage.total_cost_usd)} · olingan{" "}
            {usd(usage.total_charged_usd)}
          </span>
        }
      >
        Sarf (joriy davr)
      </CardTitle>
      {usage.items.length === 0 ? (
        <Empty>Bu davrda audio so'rov bo'lmagan.</Empty>
      ) : (
        <ul className="divide-y divide-hair">
          <li className="hidden py-2 text-sm text-ink-3 sm:grid sm:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_7rem] sm:px-2">
            <span>Xizmat</span>
            <span className="text-right">So'rov</span>
            <span className="text-right">Hajm</span>
            <span className="text-right">Tannarx</span>
            <span className="text-right">Olingan</span>
          </li>
          {usage.items.map((row) => (
            <li
              key={`${row.item}:${row.unit}`}
              className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_7rem] sm:items-center sm:px-2"
            >
              <span className="min-w-0 truncate text-[1.02rem]">{itemLabel(row.item)}</span>
              <span className="num text-ink-2 sm:text-right">
                <span className="text-ink-3 sm:hidden">So'rov: </span>
                {num(row.count)}
                {row.cached > 0 ? (
                  <span className="text-sm text-ink-3"> ({row.cached} kesh)</span>
                ) : null}
              </span>
              <span className="num text-ink-2 sm:text-right">
                <span className="text-ink-3 sm:hidden">Hajm: </span>
                {num(row.quantity)} {UNIT_LABEL[row.unit] ?? row.unit}
              </span>
              <span className="num sm:text-right">
                <span className="text-ink-3 sm:hidden">Tannarx: </span>
                {usd(row.cost_usd)}
              </span>
              <span className="num sm:text-right">
                <span className="text-ink-3 sm:hidden">Olingan: </span>
                {usd(row.charged_usd)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 max-w-[70ch] text-sm leading-relaxed text-ink-3">
        Tannarx — ElevenLabs stavkalari bo'yicha hisob (admin → Narxlar), olingan — foydalanuvchilar
        balansidan yechilgan summa. Kesh'dan qaytgan so'rovlar kredit sarflamaydi.
      </p>
    </Card>
  );
}

export function AudioPage() {
  const [view, setView] = useState<AudioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true);
    const res = await api<AudioView>(`/api/admin/elevenlabs${fresh ? "?fresh=1" : ""}`);
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
    // Kvota va sarf yangilanib turadi.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <>
      <PageTitle
        title="Audio"
        muted="ElevenLabs"
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
          <UsageCard view={view} />
        </div>
      ) : null}
    </>
  );
}
