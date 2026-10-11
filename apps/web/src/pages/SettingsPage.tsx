import { AudioLines, ExternalLink, Palette, RefreshCw, Send, Trash2 } from "lucide-react";
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
  inputClass,
} from "../ui";

interface ElevenAccount {
  configured: boolean;
  masked: string | null;
  tier: string | null;
  status: string | null;
  character_count: number | null;
  character_limit: number | null;
  remaining: number | null;
  next_reset: string | null;
  can_clone: boolean | null;
  error: string | null;
}

const number = (value: number | null) => (value === null ? "—" : value.toLocaleString("uz-UZ"));

/** Sozlamalar → ElevenLabs (P4.01): kalit tekshirilib shifrlangan holda saqlanadi, qaytarib ko'rsatilmaydi. */
function ElevenLabsSettings() {
  const [account, setAccount] = useState<ElevenAccount | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const res = await api<ElevenAccount>("/api/settings/elevenlabs");
    if (res.ok) setAccount(res.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await api<ElevenAccount>("/api/settings/elevenlabs", {
      method: "PUT",
      body: JSON.stringify({ api_key: key }),
    });
    setBusy(false);
    if (res.ok) {
      setAccount(res.data);
      setKey("");
      setMessage({ ok: true, text: "Kalit tekshirildi va saqlandi" });
    } else {
      setMessage({ ok: false, text: res.error.message ?? res.error.hint });
    }
  };

  const remove = async () => {
    if (!window.confirm("ElevenLabs kaliti o'chirilsinmi? Audio generatsiya to'xtaydi.")) return;
    await api("/api/settings/elevenlabs", { method: "DELETE" });
    setMessage({ ok: true, text: "Kalit o'chirildi" });
    await load();
  };

  const used =
    account?.character_limit && account.character_count !== null
      ? Math.round((account.character_count / account.character_limit) * 100)
      : null;

  return (
    <Card id="elevenlabs" className="scroll-mt-6">
      <CardTitle aside={<IconWell icon={AudioLines} />}>ElevenLabs</CardTitle>
      <p className="max-w-[60ch] text-[0.98rem] leading-relaxed text-ink-3">
        Ovoz (TTS), musiqa, SFX, subtitr va dublyaj uchun. Kalit serverda AES-256 bilan shifrlangan
        holda saqlanadi va qaytarib ko'rsatilmaydi. Kalitni{" "}
        <a
          className="inline-flex items-center gap-1 text-ink underline"
          href="https://elevenlabs.io/app/settings/api-keys"
          target="_blank"
          rel="noreferrer"
        >
          elevenlabs.io → API keys <ExternalLink className="h-3.5 w-3.5" />
        </a>{" "}
        bo'limidan oling.
      </p>

      {account === null ? (
        <div className="py-8">
          <Spinner />
        </div>
      ) : account.configured ? (
        <div className="mt-8 grid gap-8 sm:grid-cols-[auto_1fr] sm:items-end">
          <div>
            <Label>Qolgan belgilar</Label>
            <div className="mt-3">
              <Figure value={number(account.remaining)} />
            </div>
          </div>
          <div className="grid gap-3 sm:pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={account.error === null ? "go" : "stop"} dot={account.error === null}>
                {account.tier ?? "—"}
                {account.status ? ` · ${account.status}` : ""}
              </Pill>
              <span className="num text-[0.95rem] text-ink-3">
                {number(account.character_count)} / {number(account.character_limit)}
                {used !== null ? ` ishlatilgan (${used}%)` : ""}
              </span>
            </div>
            {used !== null ? (
              <div className="h-1 max-w-sm overflow-hidden rounded-full bg-well" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-ink"
                  style={{ width: `${Math.min(100, used)}%` }}
                />
              </div>
            ) : null}
            <div className="text-sm text-ink-3">
              Kalit: <code>{account.masked}</code>
              {account.next_reset !== null
                ? ` · yangilanish: ${new Date(account.next_reset).toLocaleString("uz-UZ")}`
                : ""}
            </div>
            {account.error !== null ? <Notice ok={false}>{account.error}</Notice> : null}
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <Pill>Kalit kiritilmagan</Pill>
        </div>
      )}

      <form onSubmit={(e) => void save(e)} className="mt-8 grid gap-3">
        <Field
          label={account?.configured ? "Yangi kalit bilan almashtirish" : "API kalit"}
          htmlFor="el-key"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="el-key"
              type="password"
              autoComplete="off"
              placeholder="sk_…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              minLength={10}
              required
              className={inputClass}
            />
            <Button type="submit" disabled={busy || key.trim().length < 10}>
              {busy ? "Tekshirilmoqda…" : "Saqlash"}
            </Button>
            {account?.configured ? (
              <Button variant="danger" onClick={() => void remove()}>
                <Trash2 /> O'chirish
              </Button>
            ) : null}
          </div>
        </Field>
        {message !== null ? <Notice ok={message.ok}>{message.text}</Notice> : null}
      </form>
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
        <div className="grid gap-5">
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
        <div className="grid gap-5">
          <p className="text-[0.98rem] text-ink-3">Xabarnomalar uchun Telegram'ni ulang.</p>
          <div>
            <Button onClick={() => void getCode()}>Ulash kodini olish</Button>
          </div>
          {code !== null ? (
            <div className="grid gap-3 rounded-[1.25rem] bg-well/70 p-5">
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
      <ul className="grid gap-1">
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
      <PageTitle title="Sozlamalar" muted="va kalitlar" />
      <div className="grid gap-6">
        <ElevenLabsSettings />
        <TelegramSettings />
        <BrandSettings />
      </div>
    </>
  );
}
