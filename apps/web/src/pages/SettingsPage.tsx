import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";

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
    <section className="card">
      <h2>ElevenLabs</h2>
      <p className="muted small">
        Ovoz (TTS), musiqa, SFX, subtitr va dublyaj uchun. Kalit serverda AES-256 bilan shifrlangan
        holda saqlanadi va qaytarib ko'rsatilmaydi. Kalitni{" "}
        <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
          elevenlabs.io → API keys
        </a>{" "}
        bo'limidan oling.
      </p>
      {account === null ? <p>Yuklanmoqda…</p> : null}
      {account?.configured ? (
        <div className="kv">
          <div>
            Kalit: <code>{account.masked}</code>
            {account.error !== null ? (
              <span className="error"> · xato: {account.error}</span>
            ) : null}
          </div>
          <div>
            Tarif: <b>{account.tier ?? "—"}</b> ({account.status ?? "—"})
          </div>
          <div>
            Belgilar: {number(account.character_count)} / {number(account.character_limit)}
            {used !== null ? ` (${used}%)` : ""} · qoldi: <b>{number(account.remaining)}</b>
          </div>
          {account.next_reset !== null ? (
            <div className="muted small">
              Yangilanish: {new Date(account.next_reset).toLocaleString("uz-UZ")}
            </div>
          ) : null}
        </div>
      ) : account !== null ? (
        <p className="muted">Kalit kiritilmagan.</p>
      ) : null}
      <form onSubmit={save} className="row">
        <input
          type="password"
          autoComplete="off"
          placeholder={account?.configured ? "Yangi kalit bilan almashtirish" : "sk_…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          minLength={10}
          required
        />
        <button type="submit" disabled={busy || key.trim().length < 10}>
          {busy ? "Tekshirilmoqda…" : "Saqlash"}
        </button>
        {account?.configured ? (
          <button type="button" className="secondary" onClick={remove}>
            O'chirish
          </button>
        ) : null}
      </form>
      {message !== null ? <p className={message.ok ? "muted" : "error"}>{message.text}</p> : null}
    </section>
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

  if (status === null) return null;
  return (
    <section className="card">
      <h2>Telegram</h2>
      {!status.enabled ? (
        <p className="muted">Serverda Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN).</p>
      ) : status.linked ? (
        <>
          <p>
            ✅ Ulangan: <b>{status.chat}</b> — render tugaganda, job to'xtaganda va batch yakunida
            xabar keladi.
          </p>
          <button className="link" onClick={() => void unlink()}>
            Uzish
          </button>
        </>
      ) : (
        <>
          <p className="muted">Xabarnomalar uchun Telegram'ni ulang.</p>
          <button onClick={() => void getCode()}>Ulash kodini olish</button>
          {code !== null ? (
            <p>
              {code.link !== null ? (
                <>
                  <a href={code.link} target="_blank" rel="noreferrer">
                    @{status.bot_username}
                  </a>{" "}
                  ni oching va Start bosing, yoki botga yuboring:{" "}
                </>
              ) : (
                "Botga yuboring: "
              )}
              <code>/start {code.code}</code> (15 daqiqa amal qiladi). Keyin{" "}
              <button className="link" onClick={() => void load()}>
                yangilang
              </button>
              .
            </p>
          ) : null}
        </>
      )}
      {error !== null ? <p className="error-text">{error}</p> : null}
    </section>
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
    <section className="card">
      <h2>Brand kit</h2>
      {brands.length === 0 ? (
        <p className="muted">
          Hali brand yo'q. "default" slug'li brand barcha videolarga qo'llanadi.
        </p>
      ) : null}
      <ul className="list">
        {brands.map((b) => (
          <li key={b.slug}>
            <b>{b.name}</b> ({b.slug}) · {b.fonts.heading.family} / {b.fonts.body.family}{" "}
            {Object.values(b.colors).map((c) => (
              <span key={c} className="swatch" style={{ background: c }} title={c} />
            ))}{" "}
            <button className="link" onClick={() => setText(JSON.stringify(b, null, 2))}>
              Tahrirlash
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void save(e)}>
        <textarea
          rows={8}
          value={text}
          placeholder='{"slug":"default","name":"Brend","colors":{"primary":"#1E40AF"},"fonts":{"heading":{"family":"Montserrat-Bold"},"body":{"family":"Inter-Regular"}}}'
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Saqlash</button>
      </form>
      {message !== null ? (
        <p className={message.ok ? "muted" : "error-text"}>{message.text}</p>
      ) : null}
    </section>
  );
}

export function SettingsPage() {
  return (
    <>
      <ElevenLabsSettings />
      <TelegramSettings />
      <BrandSettings />
    </>
  );
}
