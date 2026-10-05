import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, post } from "../api";

interface Pending {
  user_code: string;
  device_name: string;
  os: string;
}

/** Panel ko'rsatgan kodni tasdiqlash (§4.2, 3-qadam). */
export function DevicePage() {
  const initial = new URLSearchParams(window.location.search).get("code") ?? "";
  const [code, setCode] = useState(initial);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (value: string) => {
    setError(null);
    setPending(null);
    const res = await api<Pending>(`/api/devices/pending?code=${encodeURIComponent(value)}`);
    if (res.ok) setPending(res.data);
    else setError(res.error.message ?? res.error.hint);
  };

  useEffect(() => {
    if (initial !== "") void lookup(initial);
  }, [initial]);

  const decide = async (approve: boolean) => {
    if (pending === null) return;
    const res = await post<{ status: string }>("/api/devices/confirm", {
      user_code: pending.user_code,
      approve,
    });
    if (res.ok) setResult(approve ? "Qurilma ulandi. Panelga qayting." : "Rad etildi.");
    else setError(res.error.message ?? res.error.hint);
  };

  if (result !== null) return <section className="card">{result}</section>;

  return (
    <section className="card">
      <h2>Qurilmani ulash</h2>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void lookup(code);
        }}
      >
        <label htmlFor="code">Panelda ko‘rsatilgan kod</label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABC123"
          className="code"
          maxLength={9}
        />
        <button type="submit">Tekshirish</button>
      </form>
      {pending !== null ? (
        <div className="confirm">
          <p>
            <b>{pending.device_name}</b> ({pending.os}) akkauntingizga ulanmoqchi.
          </p>
          <div className="row">
            <button onClick={() => decide(true)}>Ruxsat berish</button>
            <button className="secondary" onClick={() => decide(false)}>
              Rad etish
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
