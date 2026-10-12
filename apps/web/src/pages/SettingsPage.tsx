import { Palette, RefreshCw, Send, Sparkles, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Field,
  Figure,
  IconWell,
  Label,
  Notice,
  PageTitle,
  Pill,
  Spinner,
  Toggle,
  inputClass,
} from "../ui";

interface Billing {
  enforced: boolean;
  activated: boolean;
  balance_usd: number;
  activation_usd: number;
  pro_music: boolean;
  pro_isolation: boolean;
  prices: {
    music_pro_per_min: number;
    music_library_per_min: number;
    isolation_pro_per_min: number;
    isolation_standard_per_min: number;
  };
  /** To'lov qo'lda (P9.03): kimga murojaat qilish va paketlar. */
  contact: string | null;
  tariffs: {
    id: string;
    name: string;
    description: string;
    price_usd: number;
    credit_usd: number;
    bonus_usd: number;
  }[];
  history: {
    id: number;
    kind: string;
    item: string;
    amount_usd: number;
    cached: boolean;
    note: string | null;
    created_at: string;
  }[];
}

/** Sarf yozuvlari uchun tushunarli nom. */
const ITEM: Record<string, string> = {
  topup: "To'ldirish",
  adjust: "Tuzatish",
  timeline: "Montaj (timeline)",
  "music.pro": "Musiqa — generatsiya (Pro)",
  "music.basic": "Musiqa — kutubxona",
  "isolate.pro": "Ovoz tozalash (Pro)",
  "isolate.basic": "Ovoz tozalash",
  tts: "Ovoz (TTS)",
  dialogue: "Dialog",
  stt: "Transkripsiya",
  align: "Subtitr vaqtlari",
  sfx: "Ovoz effekti",
  dub: "Dublyaj",
  voice_change: "Ovoz almashtirish",
  voice_design: "Ovoz dizayni",
};

const usd = (value: number) =>
  `${value < 0 ? "−" : ""}${Math.abs(value) < 0.01 && value !== 0 ? Math.abs(value).toFixed(4) : Math.abs(value).toFixed(2)} $`;

/** Sozlamalar → Balans va Pro (P8.09): balans dollarda, Pro tugmalari narx eslatmasi bilan. */
function BalanceSettings() {
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<Billing>("/api/me/billing");
    if (res.ok) setData(res.data);
    else setError(res.error.message ?? res.error.hint);
  };
  useEffect(() => {
    void load();
  }, []);

  const toggle = async (key: "pro_music" | "pro_isolation", value: boolean) => {
    if (data === null) return;
    if (value) {
      const text =
        key === "pro_music"
          ? `Pro musiqa: Claude kutubxonada mos trek topmasa yangi musiqa generatsiya qiladi — ${usd(data.prices.music_pro_per_min)}/daq (kutubxona: ${usd(data.prices.music_library_per_min)}/daq). Har safar so'ramaydi. Yoqilsinmi?`
          : `Pro ovoz tozalash: ${usd(data.prices.isolation_pro_per_min)}/daq (standart: ${usd(data.prices.isolation_standard_per_min)}/daq). Har safar so'ramaydi. Yoqilsinmi?`;
      if (!window.confirm(text)) return;
    }
    const res = await api<Billing>("/api/me/preferences", {
      method: "PUT",
      body: JSON.stringify({ [key]: value }),
    });
    if (res.ok) setData({ ...data, ...res.data, history: data.history });
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <Card id="balance" className="scroll-mt-6">
      <CardTitle aside={<IconWell icon={Wallet} />}>Balans va Pro</CardTitle>
      {data === null ? (
        error === null ? (
          <Spinner />
        ) : (
          <Notice ok={false}>{error}</Notice>
        )
      ) : (
        <div className="grid gap-8">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <Label>Balans</Label>
              <div className="mt-3">
                <Figure value={data.balance_usd.toFixed(2)} suffix="$" />
              </div>
            </div>
            <div className="grid gap-2 pb-2">
              <Pill tone={data.activated ? "go" : "wait"} dot={data.activated}>
                {data.activated
                  ? "Faol"
                  : `Faollashtirish: ${data.activation_usd} $ boshlang'ich to'lov`}
              </Pill>
              <span className="text-sm text-ink-3">
                Balansni administrator to'ldiradi. Sarf ishlatilgan sari yechiladi.
              </span>
            </div>
          </div>

          <div className="grid gap-4">
            {(
              [
                {
                  key: "pro_music",
                  title: "Pro musiqa",
                  text: `Kutubxonada mos trek bo'lmasa yangi musiqa generatsiyasi — ${usd(data.prices.music_pro_per_min)}/daq. O'chiq bo'lsa Claude har safar narxni aytib so'raydi.`,
                },
                {
                  key: "pro_isolation",
                  title: "Pro ovoz tozalash",
                  text: `Kuchli tozalash (musiqadan ham ajratadi) — ${usd(data.prices.isolation_pro_per_min)}/daq. Standart: ${usd(data.prices.isolation_standard_per_min)}/daq.`,
                },
              ] as const
            ).map((row) => (
              <div
                key={row.key}
                className="flex items-start justify-between gap-4 rounded-[1.25rem] bg-white p-5 shadow-raise"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[1.05rem] font-normal">
                    <Sparkles className="h-4 w-4 text-ink-3" /> {row.title}
                    {data[row.key] ? <Pill tone="wait">Balansdan ko'proq yechiladi</Pill> : null}
                  </div>
                  <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-ink-3">{row.text}</p>
                </div>
                <Toggle
                  checked={data[row.key]}
                  label={row.title}
                  onChange={(value) => void toggle(row.key, value)}
                />
              </div>
            ))}
          </div>

          {data.tariffs.length > 0 || data.contact !== null ? (
            <div>
              <Label>To'ldirish</Label>
              {data.tariffs.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {data.tariffs.map((t) => (
                    <li key={t.id} className="rounded-[1.25rem] bg-white p-5 shadow-raise">
                      <div className="flex flex-wrap items-center gap-2 text-[1.05rem] font-normal">
                        {t.name}
                        {t.bonus_usd > 0 ? <Pill tone="go">+{usd(t.bonus_usd)} bonus</Pill> : null}
                      </div>
                      <p className="mt-1 text-sm text-ink-3">
                        To'lov {usd(t.price_usd)} → balansga {usd(t.credit_usd)}
                        {t.description !== "" ? ` · ${t.description}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-sm text-ink-3">
                To'lov hozircha administrator orqali
                {data.contact !== null ? (
                  <>
                    : <span className="text-ink">{data.contact}</span>
                  </>
                ) : null}
                . To'lov tushgach balans shu yerda ko'rinadi.
              </p>
            </div>
          ) : null}

          <div>
            <Label>Oxirgi sarflar</Label>
            {data.history.length === 0 ? (
              <p className="mt-3 text-sm text-ink-3">Hali sarf yo'q.</p>
            ) : (
              <ul className="mt-3 divide-y divide-hair">
                {data.history.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
                  >
                    <span className="min-w-0 text-[0.95rem] font-normal">
                      {ITEM[row.item] ?? row.item}
                      {row.cached ? <span className="text-ink-3"> · keshdan</span> : null}
                    </span>
                    <span className="num flex items-baseline gap-3 text-sm">
                      <span className="text-ink-3">
                        {new Date(row.created_at).toLocaleString("uz-UZ")}
                      </span>
                      <span className={row.amount_usd >= 0 ? "text-go" : "text-ink"}>
                        {row.amount_usd >= 0 ? "+" : ""}
                        {usd(row.amount_usd)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

interface TelegramStatus {
  enabled: boolean;
  linked: boolean;
  bot_username: string | null;
  chat: string | null;
}

/** Sozlamalar → Telegram (P5.08): bir martalik kod → botga /start <kod>. */
function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [code, setCode] = useState<{ code: string; link: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await api<TelegramStatus>("/api/settings/telegram");
    if (res.ok) setStatus(res.data);
  };
  useEffect(() => {
    void load();
  }, []);

  const getCode = async () => {
    setError(null);
    const res = await api<{ code: string; link: string | null }>("/api/settings/telegram/code", {
      method: "POST",
    });
    if (res.ok) setCode(res.data);
    else setError(res.error.message ?? res.error.hint);
  };
  const unlink = async () => {
    await api("/api/settings/telegram", { method: "DELETE" });
    setCode(null);
    await load();
  };

  return (
    <Card id="telegram" className="scroll-mt-6">
      <CardTitle aside={<IconWell icon={Send} />}>Telegram</CardTitle>
      {status === null ? (
        <Spinner />
      ) : !status.enabled ? (
        <p className="text-[0.98rem] text-ink-3">
          Serverda Telegram bot sozlanmagan (<code>TELEGRAM_BOT_TOKEN</code>).
        </p>
      ) : status.linked ? (
        <div className="grid grid-cols-1 gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="go" dot>
              Ulangan
            </Pill>
            <span className="text-[1.05rem] font-normal">{status.chat}</span>
          </div>
          <p className="max-w-[60ch] text-[0.98rem] leading-relaxed text-ink-3">
            Render tugaganda, job to'xtaganda va batch yakunida xabar keladi.
          </p>
          <div>
            <Button size="sm" variant="danger" className="-ml-3.5" onClick={() => void unlink()}>
              Uzish
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <p className="text-[0.98rem] text-ink-3">Xabarnomalar uchun Telegram'ni ulang.</p>
          <div>
            <Button onClick={() => void getCode()}>Ulash kodini olish</Button>
          </div>
          {code !== null ? (
            <div className="grid grid-cols-1 gap-3 rounded-[1.25rem] bg-well/70 p-5">
              <div className="text-[0.98rem] leading-relaxed text-ink-2">
                {code.link !== null ? (
                  <>
                    <a
                      className="text-ink underline"
                      href={code.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{status.bot_username}
                    </a>{" "}
                    ni oching va Start bosing, yoki botga yuboring:
                  </>
                ) : (
                  "Botga yuboring:"
                )}
              </div>
              <div className="num font-mono text-[1.4rem] font-light tracking-[0.04em]">
                /start {code.code}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-3">
                Kod 15 daqiqa amal qiladi.
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  <RefreshCw /> Holatni yangilash
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {error !== null ? (
        <div className="mt-4">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

interface BrandView {
  slug: string;
  name: string;
  colors: Record<string, string>;
  fonts: { heading: { family: string }; body: { family: string } };
}

/** Sozlamalar → Brand kit'lar (P5.04): ro'yxat va JSON tahrir (brand_save bilan bir xil sxema). */
function BrandSettings() {
  const [brands, setBrands] = useState<BrandView[]>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const res = await api<BrandView[]>("/api/brands");
    if (res.ok) setBrands(res.data);
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      setMessage({ ok: false, text: "JSON noto'g'ri" });
      return;
    }
    const res = await api<BrandView>("/api/brands", { method: "PUT", body: JSON.stringify(body) });
    setMessage(
      res.ok
        ? { ok: true, text: `Saqlandi: ${res.data.slug}` }
        : { ok: false, text: res.error.message ?? res.error.hint },
    );
    if (res.ok) await load();
  };

  return (
    <Card id="brand" className="scroll-mt-6">
      <CardTitle aside={<IconWell icon={Palette} />}>Brand kit</CardTitle>
      {brands.length === 0 ? (
        <p className="text-[0.98rem] text-ink-3">
          Hali brand yo'q. <code>default</code> slug'li brand barcha videolarga qo'llanadi.
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-1">
        {brands.map((b) => (
          <li
            key={b.slug}
            className="-mx-3 flex flex-wrap items-center justify-between gap-3 rounded-[1rem] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-[1.05rem] font-normal">
                {b.name} <span className="text-ink-3">({b.slug})</span>
              </div>
              <div className="text-sm text-ink-3">
                {b.fonts.heading.family} / {b.fonts.body.family}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex -space-x-1.5">
                {Object.entries(b.colors).map(([name, c]) => (
                  <span
                    key={name}
                    title={`${name}: ${c}`}
                    className="h-7 w-7 rounded-full shadow-[0_0_0_2px_#f8f8f8,0_2px_4px_rgb(0_0_0/0.12)]"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setText(JSON.stringify(b, null, 2))}
              >
                Tahrirlash
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void save(e)} className="mt-6 grid gap-3">
        <Field label="Brand JSON" htmlFor="brand-json">
          <textarea
            id="brand-json"
            rows={8}
            value={text}
            placeholder='{"slug":"default","name":"Brend","colors":{"primary":"#1E40AF"},"fonts":{"heading":{"family":"Montserrat-Bold"},"body":{"family":"Inter-Regular"}}}'
            onChange={(e) => setText(e.target.value)}
            className={`${inputClass} font-mono text-[0.85rem] leading-relaxed`}
          />
        </Field>
        <div>
          <Button type="submit">Saqlash</Button>
        </div>
        {message !== null ? <Notice ok={message.ok}>{message.text}</Notice> : null}
      </form>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageTitle title="Sozlamalar" muted="va balans" />
      <div className="grid grid-cols-1 gap-6">
        <BalanceSettings />
        <TelegramSettings />
        <BrandSettings />
      </div>
    </>
  );
}
