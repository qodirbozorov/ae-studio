/** Admin → Foydalanuvchilar (P9.02–P9.03): ro'yxat, qidiruv, profil, balans to'ldirish, bloklash. */
import {
  ArrowLeft,
  Ban,
  Bot,
  LogOut,
  MonitorSmartphone,
  Plus,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { api, post } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Empty,
  Figure,
  IconWell,
  Label,
  Loading,
  Notice,
  OnlineBadge,
  PageTitle,
  Pill,
  Segmented,
  StateBadge,
  ago,
  cx,
  day,
  inputClass,
  when,
} from "../ui";

type Status = "all" | "active" | "inactive" | "blocked";

interface UserRow {
  id: string;
  name: string;
  telegram_id: string | null;
  email: string | null;
  balance_usd: number;
  activated: boolean;
  blocked: boolean;
  devices: number;
  last_seen_at: string | null;
  created_at: string;
}

interface Totals {
  topup_usd: number;
  spent_usd: number;
  cost_usd: number;
  margin_usd: number;
}

interface Overview {
  users: { total: number; activated: number; blocked: number; balance_usd: number };
  all_time: Totals;
  last_30d: Totals;
}

export interface Tariff {
  id: string;
  name: string;
  description: string;
  price_usd: number;
  credit_usd: number;
  bonus_usd: number;
  active: boolean;
  sort: number;
}

interface Profile {
  id: string;
  name: string;
  telegram_id: string | null;
  email: string | null;
  created_at: string;
  blocked_at: string | null;
  blocked_reason: string | null;
  prefs: { pro_music?: boolean; pro_isolation?: boolean };
  account: { activated: boolean; balance_usd: number; activation_usd: number; enforced: boolean };
  totals: { topup_usd: number; adjust_usd: number; spent_usd: number; cost_usd: number };
  devices: {
    id: string;
    name: string;
    os: string;
    ae_version: string | null;
    last_seen_at: string | null;
    revoked: boolean;
    online: boolean;
  }[];
  jobs: {
    id: string;
    project: string;
    state: string;
    outcome: string | null;
    created_at: string;
  }[];
  apps: { client_id: string; name: string | null; last_at: string }[];
  sessions: number;
  telegram: { chat: string | null; linked_at: string | null } | null;
  history: {
    id: number;
    kind: string;
    item: string;
    amount_usd: number;
    cost_usd: number;
    cached: boolean;
    note: string | null;
    created_by: string;
    created_at: string;
  }[];
}

export const usd = (value: number, digits = 2) =>
  `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : digits)} $`;

const FILTERS = [
  { key: "all", label: "Hammasi" },
  { key: "active", label: "Faol" },
  { key: "inactive", label: "To'lovsiz" },
  { key: "blocked", label: "Bloklangan" },
] as const;

function OverviewCard() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    void api<Overview>("/api/admin/overview").then((res) => res.ok && setData(res.data));
  }, []);
  if (data === null) return null;
  const cells = [
    {
      label: "Foydalanuvchilar",
      value: String(data.users.total),
      suffix: `${data.users.activated} faol`,
    },
    { label: "Tushum (jami)", value: data.all_time.topup_usd.toFixed(0), suffix: "$" },
    { label: "Sarf, 30 kun", value: data.last_30d.spent_usd.toFixed(2), suffix: "$" },
    { label: "Marja, 30 kun", value: data.last_30d.margin_usd.toFixed(2), suffix: "$" },
  ];
  return (
    <Card className="mb-5">
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="min-w-0">
            <Label>{cell.label}</Label>
            <div className="mt-3">
              <Figure value={cell.value} suffix={cell.suffix} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-3">
        Foydalanuvchilar balansi jami: {usd(data.users.balance_usd)} · bloklangan:{" "}
        {data.users.blocked}
      </p>
    </Card>
  );
}

function UserList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      const params = new URLSearchParams({ status, offset: String(offset) });
      if (q.trim() !== "") params.set("q", q.trim());
      const res = await api<{ users: UserRow[]; total: number; next_offset: number | null }>(
        `/api/admin/users?${params}`,
      );
      if (!res.ok) {
        setError(res.error.message ?? res.error.hint);
        return;
      }
      setError(null);
      setRows((prev) => (offset === 0 ? res.data.users : [...(prev ?? []), ...res.data.users]));
      setTotal(res.data.total);
      setNext(res.data.next_offset);
    },
    [q, status],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(0), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <Card>
      <CardTitle aside={<span className="text-sm text-ink-3">{total} ta</span>}>Ro'yxat</CardTitle>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <input
            aria-label="Qidiruv"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ism, @username, Telegram ID, email yoki ID"
            className={cx(inputClass, "pl-11")}
          />
        </div>
        <Segmented options={FILTERS} value={status} onChange={setStatus} />
      </div>
      {error !== null ? <Notice ok={false}>{error}</Notice> : null}
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Hech kim topilmadi.</Empty>
      ) : (
        <ul className="divide-y divide-hair">
          {rows.map((row) => (
            <li key={row.id}>
              <a
                href={`/admin/users/${row.id}`}
                className="grid gap-1.5 py-3 text-ink no-underline transition-colors hover:bg-[#fafafa] sm:grid-cols-[minmax(0,1fr)_7rem_17rem] sm:items-center sm:px-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[1.05rem] font-normal">{row.name}</span>
                  <span className="block truncate text-sm text-ink-3">
                    {row.telegram_id !== null ? `tg ${row.telegram_id}` : (row.email ?? row.id)}
                    {" · "}
                    {day(row.created_at)}
                  </span>
                </span>
                <span className="num text-[1.05rem] sm:text-right">{usd(row.balance_usd)}</span>
                <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {row.blocked ? (
                    <Pill tone="stop" icon={Ban}>
                      Bloklangan
                    </Pill>
                  ) : row.activated ? (
                    <Pill tone="go">Faol</Pill>
                  ) : (
                    <Pill tone="wait">To'lovsiz</Pill>
                  )}
                  <span className="text-sm whitespace-nowrap text-ink-3">
                    {row.devices > 0
                      ? `${row.devices} panel · ${ago(row.last_seen_at)}`
                      : "panel yo'q"}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {next !== null ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void load(next)}>
            Yana
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

const ITEM: Record<string, string> = {
  topup: "To'ldirish",
  adjust: "Tuzatish",
  timeline: "Montaj",
  "music.pro": "Musiqa (Pro)",
  "music.basic": "Musiqa (kutubxona)",
  "isolate.pro": "Tozalash (Pro)",
  "isolate.basic": "Tozalash",
  tts: "TTS",
  dialogue: "Dialog",
  stt: "Transkripsiya",
  align: "Subtitr vaqtlari",
  sfx: "SFX",
  dub: "Dublyaj",
  voice_change: "Ovoz almashtirish",
  voice_design: "Ovoz dizayni",
};

function Topup({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [mode, setMode] = useState<"tariff" | "amount">("tariff");
  const [tariffId, setTariffId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void api<{ tariffs: Tariff[] }>("/api/admin/tariffs").then((res) => {
      if (!res.ok) return;
      const active = res.data.tariffs.filter((t) => t.active);
      setTariffs(active);
      if (active.length === 0) setMode("amount");
      else setTariffId(active[0]!.id);
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount.replace(",", "."));
    const body =
      mode === "tariff" ? { tariff_id: tariffId } : { usd: Number.isFinite(value) ? value : NaN };
    const picked = tariffs.find((t) => t.id === tariffId);
    const label =
      mode === "tariff" && picked !== undefined
        ? `«${picked.name}»: +${usd(picked.credit_usd)}`
        : `${value >= 0 ? "+" : ""}${usd(value)}`;
    if (!window.confirm(`${profile.name} balansiga ${label}?`)) return;
    setBusy(true);
    const res = await post<Profile["account"]>(`/api/admin/users/${profile.id}/topup`, {
      ...body,
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      setResult({ ok: true, text: `Balans: ${usd(res.data.balance_usd)}` });
      setAmount("");
      setNote("");
      onDone();
    } else setResult({ ok: false, text: res.error.message ?? res.error.hint });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <Segmented
        options={[
          { key: "tariff", label: "Tarif bo'yicha" },
          { key: "amount", label: "Erkin summa" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === "tariff" ? (
        tariffs.length === 0 ? (
          <p className="text-sm text-ink-3">
            Faol tarif yo'q — <a href="/admin/pricing">Narxlar</a> bo'limida qo'shing.
          </p>
        ) : (
          <select
            aria-label="Tarif"
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
            className={inputClass}
          >
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — to'lov {usd(t.price_usd)}, balansga {usd(t.credit_usd)}
              </option>
            ))}
          </select>
        )
      ) : (
        <input
          aria-label="Summa, $"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Summa, $ (tuzatish uchun manfiy: -1.5)"
          className={inputClass}
          required
        />
      )}
      <input
        aria-label="Izoh"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Izoh: to'lov usuli, chek raqami…"
        className={inputClass}
        maxLength={500}
      />
      {result !== null ? <Notice ok={result.ok}>{result.text}</Notice> : null}
      <div>
        <Button type="submit" disabled={busy || (mode === "tariff" && tariffs.length === 0)}>
          <Plus /> {busy ? "Yozilmoqda…" : "Balansga qo'shish"}
        </Button>
      </div>
    </form>
  );
}

function UserProfile({ id }: { id: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await api<Profile>(`/api/admin/users/${id}`);
    if (res.ok) setProfile(res.data);
    else setError(res.error.message ?? res.error.hint);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) return <Notice ok={false}>{error}</Notice>;
  if (profile === null) return <Loading />;

  const block = async () => {
    const reason = window.prompt(
      `${profile.name} bloklansinmi? Barcha sessiyalar, panel va Claude ulanishlari bekor qilinadi.\nSabab (ixtiyoriy):`,
      "",
    );
    if (reason === null) return;
    const res = await post<{ revoked: number }>(`/api/admin/users/${profile.id}/block`, {
      ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
    });
    setMessage(
      res.ok
        ? { ok: true, text: `Bloklandi, ${res.data.revoked} ta token bekor qilindi` }
        : { ok: false, text: res.error.message ?? res.error.hint },
    );
    void load();
  };

  const unblock = async () => {
    if (!window.confirm(`${profile.name} blokdan chiqarilsinmi? Qayta kirishi kerak bo'ladi.`))
      return;
    const res = await post(`/api/admin/users/${profile.id}/unblock`);
    setMessage(
      res.ok ? { ok: true, text: "Blokdan chiqarildi" } : { ok: false, text: res.error.hint },
    );
    void load();
  };

  const logout = async (claude: boolean) => {
    const text = claude
      ? "Barcha kabinet sessiyalari va Claude ulanishlari bekor qilinsinmi?"
      : "Barcha kabinet sessiyalari bekor qilinsinmi?";
    if (!window.confirm(text)) return;
    const res = await post<{ revoked: number }>(`/api/admin/users/${profile.id}/logout`, {
      claude,
    });
    setMessage(
      res.ok
        ? { ok: true, text: `${res.data.revoked} ta token bekor qilindi` }
        : { ok: false, text: res.error.hint },
    );
    void load();
  };

  const blocked = profile.blocked_at !== null;

  return (
    <>
      <a
        href="/admin/users"
        className="mb-6 inline-flex items-center gap-2 text-sm text-ink-3 no-underline hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Foydalanuvchilar
      </a>
      <PageTitle
        title={profile.name}
        action={
          blocked ? (
            <Pill tone="stop" icon={Ban}>
              Bloklangan {when(profile.blocked_at)}
            </Pill>
          ) : profile.account.activated ? (
            <Pill tone="go">Faol</Pill>
          ) : (
            <Pill tone="wait">To'lovsiz</Pill>
          )
        }
      />
      {message !== null ? (
        <div className="mb-6">
          <Notice ok={message.ok}>{message.text}</Notice>
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <CardTitle aside={<IconWell icon={Wallet} />}>Balans</CardTitle>
          <Figure value={profile.account.balance_usd.toFixed(2)} suffix="$" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            {[
              ["To'ldirilgan", profile.totals.topup_usd],
              ["Sarf", profile.totals.spent_usd],
              ["Tannarx", profile.totals.cost_usd],
              ["Tuzatish", profile.totals.adjust_usd],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-ink-3">{label}</dt>
                <dd className="num mt-1 text-[1.05rem]">{usd(value as number)}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <Topup profile={profile} onDone={() => void load()} />
          </div>
        </Card>

        <Card>
          <CardTitle aside={<IconWell icon={ShieldCheck} />}>Hisob</CardTitle>
          <dl className="grid gap-3 text-[0.95rem]">
            <Row label="Telegram">{profile.telegram_id ?? "—"}</Row>
            <Row label="Bot chati">{profile.telegram?.chat ?? "ulanmagan"}</Row>
            {profile.email !== null ? <Row label="Email">{profile.email}</Row> : null}
            <Row label="Ro'yxatdan o'tgan">{when(profile.created_at)}</Row>
            <Row label="Faol sessiyalar">{profile.sessions}</Row>
            <Row label="Pro">
              {[
                profile.prefs.pro_music ? "musiqa" : null,
                profile.prefs.pro_isolation ? "tozalash" : null,
              ]
                .filter(Boolean)
                .join(", ") || "o'chiq"}
            </Row>
            {blocked && profile.blocked_reason !== null ? (
              <Row label="Blok sababi">{profile.blocked_reason}</Row>
            ) : null}
            <Row label="ID">
              <span className="font-mono text-[0.8rem]">{profile.id}</span>
            </Row>
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => void logout(false)}>
              <LogOut /> Sessiyalarni bekor qilish
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void logout(true)}>
              <Bot /> + Claude ulanishlari
            </Button>
            {blocked ? (
              <Button size="sm" onClick={() => void unblock()}>
                Blokdan chiqarish
              </Button>
            ) : (
              <Button variant="danger" size="sm" onClick={() => void block()}>
                <Ban /> Bloklash
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle aside={<IconWell icon={MonitorSmartphone} />}>Panellar va ilovalar</CardTitle>
          {profile.devices.length === 0 ? (
            <p className="text-sm text-ink-3">Panel ulanmagan.</p>
          ) : (
            <ul className="divide-y divide-hair">
              {profile.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="min-w-0">
                    <span className="block truncate">{d.name}</span>
                    <span className="block text-sm text-ink-3">
                      {d.os}
                      {d.ae_version !== null ? ` · AE ${d.ae_version}` : ""} · {ago(d.last_seen_at)}
                    </span>
                  </span>
                  <OnlineBadge online={d.online} revoked={d.revoked} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6">
            <Label>Claude ulanishlari</Label>
            {profile.apps.length === 0 ? (
              <p className="mt-2 text-sm text-ink-3">Yo'q.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-sm">
                {profile.apps.map((a) => (
                  <li key={a.client_id} className="flex justify-between gap-3">
                    <span className="truncate">{a.name ?? a.client_id}</span>
                    <span className="text-ink-3">{ago(a.last_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle aside={<IconWell icon={Users} />}>Oxirgi joblar</CardTitle>
          {profile.jobs.length === 0 ? (
            <p className="text-sm text-ink-3">Job yo'q.</p>
          ) : (
            <ul className="divide-y divide-hair">
              {profile.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="min-w-0">
                    <span className="block truncate">{j.project}</span>
                    <span className="block text-sm text-ink-3">{when(j.created_at)}</span>
                  </span>
                  <StateBadge state={j.state} outcome={j.outcome} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardTitle>Sarf va to'ldirish tarixi</CardTitle>
        {profile.history.length === 0 ? (
          <p className="text-sm text-ink-3">Hali yozuv yo'q.</p>
        ) : (
          <ul className="divide-y divide-hair">
            {profile.history.map((row) => (
              <li
                key={row.id}
                className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
              >
                <span className="min-w-0">
                  <span>{ITEM[row.item] ?? row.item}</span>
                  {row.cached ? <span className="text-ink-3"> · keshdan</span> : null}
                  {row.note !== null ? (
                    <span className="block truncate text-sm text-ink-3">{row.note}</span>
                  ) : null}
                </span>
                <span className="num flex flex-wrap items-baseline gap-3 text-sm">
                  <span className="text-ink-3">{when(row.created_at)}</span>
                  {row.kind === "charge" && row.cost_usd > 0 ? (
                    <span className="text-ink-3" title="Tannarx">
                      ({usd(row.cost_usd, 4)})
                    </span>
                  ) : null}
                  <span className={row.amount_usd >= 0 ? "text-go" : "text-ink"}>
                    {row.amount_usd >= 0 ? "+" : ""}
                    {usd(row.amount_usd, 4)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function UsersPage() {
  const match = /^\/admin\/users\/([0-9a-f-]{36})\/?$/.exec(window.location.pathname);
  if (match !== null) return <UserProfile id={match[1]!} />;
  return (
    <>
      <PageTitle title="Foydalanuvchilar" muted="va balans" />
      <OverviewCard />
      <UserList />
    </>
  );
}
