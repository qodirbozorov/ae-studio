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

export function SettingsPage() {
  return <ElevenLabsSettings />;
}
