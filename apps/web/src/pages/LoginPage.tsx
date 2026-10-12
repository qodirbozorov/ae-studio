import { ExternalLink, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, post } from "../api";
import { Button, Logo, Notice, Pill } from "../ui";

interface Start {
  link: string;
  bot: string;
  /** Botda shu raqam tanlanadi (P9.06). */
  match_code: string;
  expires_at: string;
  poll_ms: number;
}

type Status =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "rejected"; reason: string }
  | { status: "ok"; next: string };

const REJECTED: Record<string, string> = {
  wrong_code: "Botda boshqa raqam tanlandi — kirish bekor qilindi. Qaytadan bosing.",
  not_me: "Botda «Bu men emas» tanlandi — kirish bekor qilindi.",
  blocked: "Hisob bloklangan. Administratorga murojaat qiling.",
};

/** Kirish Telegram bot orqali: deep link → botda Start → shu sahifa o'zi kiradi. */
export function LoginPage({ next }: { next: string }) {
  const [start, setStart] = useState<Start | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "expired" | "rejected">("idle");
  const [reason, setReason] = useState("");
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
      } else if (poll.data.status === "rejected") {
        stop();
        setReason(poll.data.reason);
        setState("rejected");
      }
    }, res.data.poll_ms);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-[34rem] rounded-[2rem] bg-shell px-7 py-10 sm:rounded-shell sm:px-12 sm:py-14">
        <Logo className="h-14" />
        <h1 className="mt-10 text-[2.5rem] leading-[1.05] font-light tracking-[-0.035em] sm:text-[3.25rem]">
          AE Studio <span className="text-ink-4">kabineti</span>
        </h1>

        <div className="surface mt-10 p-7 sm:p-9">
          {state === "waiting" && start !== null ? (
            <div className="grid grid-cols-1 gap-5">
              <Pill tone="wait" dot>
                Telegram kutilmoqda
              </Pill>
              <p className="text-[1.05rem] leading-relaxed text-ink-2">
                Telegram'da <span className="font-normal text-ink">@{start.bot}</span> ochildi —{" "}
                <span className="font-normal text-ink">Start</span> tugmasini bosing, so'ng botda
                shu raqamni tanlang:
              </p>
              <div
                aria-label="Tasdiqlash raqami"
                className="num text-center text-[4.5rem] leading-none font-extralight tracking-[0.08em]"
              >
                {start.match_code}
              </div>
              <p className="text-[0.95rem] leading-relaxed text-ink-3">
                Botdagi brauzer va IP shu qurilmaniki ekanini tekshiring. Raqamni hech kimga aytmang
                — AE Studio uni hech qachon so'ramaydi.
              </p>
              <p className="text-[0.95rem] text-ink-3">
                Ochilmadimi?{" "}
                <a
                  className="inline-flex items-center gap-1 text-ink underline"
                  href={start.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Botni ochish <ExternalLink className="h-3.5 w-3.5" />
                </a>{" "}
                · havola 10 daqiqa amal qiladi.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6">
              <p className="text-[1.05rem] leading-relaxed text-ink-2">
                Kirish va ro'yxatdan o'tish Telegram orqali — parol va email kerak emas.
              </p>
              {state === "expired" ? (
                <Notice ok={false}>Havola eskirdi, qaytadan bosing.</Notice>
              ) : null}
              {state === "rejected" ? (
                <Notice ok={false}>{REJECTED[reason] ?? "Kirish rad etildi."}</Notice>
              ) : null}
              <Button className="w-full sm:w-fit" onClick={() => void begin()}>
                <Send /> Telegram orqali kirish
              </Button>
            </div>
          )}
          {error !== null ? (
            <div className="mt-5">
              <Notice ok={false}>{error}</Notice>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
