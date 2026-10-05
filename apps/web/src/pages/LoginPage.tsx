import { useState } from "react";
import type { FormEvent } from "react";
import { post } from "../api";

export function LoginPage({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("sending");
    setError(null);
    const res = await post("/api/auth/magic-link", {
      email,
      next: next === "/" ? undefined : next,
    });
    if (res.ok) setState("sent");
    else {
      setState("idle");
      setError(res.error.message ?? res.error.hint);
    }
  };

  return (
    <main className="page narrow">
      <h1>AE Studio</h1>
      {state === "sent" ? (
        <p>
          <b>{email}</b> manziliga kirish havolasi yuborildi. Pochtangizni oching (havola 15 daqiqa
          amal qiladi).
        </p>
      ) : (
        <form onSubmit={submit} className="card">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="siz@misol.uz"
          />
          <button type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Yuborilmoqda…" : "Kirish havolasini olish"}
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      )}
    </main>
  );
}
