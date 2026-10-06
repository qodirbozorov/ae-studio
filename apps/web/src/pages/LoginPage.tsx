import { useEffect, useRef, useState } from "react";
import { api, post } from "../api";

interface Start {
  link: string;
  bot: string;
  expires_at: string;
  poll_ms: number;
}

type Status = { status: "pending" } | { status: "expired" } | { status: "ok"; next: string };

/** Kirish Telegram bot orqali: deep link → botda Start → shu sahifa o'zi kiradi. */
export function LoginPage({ next }: { next: string }) {
  const [start, setStart] = useState<Start | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "expired">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  const begin = async () => {
    setError(null);
    stop();
    // Oyna bosish paytida ochiladi (popup bloker), havola javobdan keyin beriladi.
    const tab = window.open("about:blank", "_blank");
    const res = await post<Start>("/api/auth/telegram", next === "/" ? {} : { next });
    if (!res.ok) {
      tab?.close();
      setError(res.error.message ?? res.error.hint);
      return;
    }
    setStart(res.data);
    setState("waiting");
    if (tab !== null) tab.location.href = res.data.link;
    timer.current = window.setInterval(async () => {
      const poll = await api<Status>("/api/auth/telegram/status");
      if (!poll.ok) return;
      if (poll.data.status === "ok") {
        stop();
        window.location.href = poll.data.next;
      } else if (poll.data.status === "expired") {
        stop();
        setState("expired");
      }
    }, res.data.poll_ms);
  };

  return (
    <main className="page narrow">
      <h1>AE Studio</h1>
      <section className="card">
        {state === "waiting" && start !== null ? (
          <>
            <p>
              Telegram'da <b>@{start.bot}</b> ochildi — <b>Start</b> tugmasini bosing. Shu sahifa
              o'zi kabinetga kiradi.
            </p>
            <p className="muted">
              Ochilmadimi?{" "}
              <a href={start.link} target="_blank" rel="noreferrer">
                Botni ochish
              </a>{" "}
              (havola 10 daqiqa amal qiladi).
            </p>
          </>
        ) : (
          <>
            <p>Kirish va ro'yxatdan o'tish Telegram orqali — parol va email kerak emas.</p>
            {state === "expired" ? <p className="error">Havola eskirdi, qaytadan bosing.</p> : null}
            <button type="button" onClick={() => void begin()}>
              Telegram orqali kirish
            </button>
          </>
        )}
        {error !== null ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
