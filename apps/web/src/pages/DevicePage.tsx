import { Check, Monitor, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, post } from "../api";
import { Button, Card, IconWell, LinkButton, Notice, PageTitle, cx, inputClass } from "../ui";

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
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
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
    if (res.ok)
      setResult(
        approve
          ? { ok: true, text: "Qurilma ulandi. Panelga qayting." }
          : { ok: false, text: "Rad etildi." },
      );
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <>
      <PageTitle title="Qurilmani" muted="ulash" />
      <Card className="max-w-[40rem]">
        {result !== null ? (
          <div className="grid gap-6">
            <Notice ok={result.ok}>{result.text}</Notice>
            <div>
              <LinkButton href="/">Qurilmalarga qaytish</LinkButton>
            </div>
          </div>
        ) : (
          <>
            <p className="max-w-[48ch] text-[1.05rem] leading-relaxed text-ink-2">
              After Effects'dagi AE Studio paneli ko'rsatgan 6 belgili kodni kiriting.
            </p>
            <form
              className="mt-8 flex flex-col gap-3 sm:flex-row"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void lookup(code);
              }}
            >
              <label htmlFor="code" className="sr-only">
                Panelda ko'rsatilgan kod
              </label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABC123"
                maxLength={9}
                autoComplete="one-time-code"
                spellCheck={false}
                className={cx(
                  inputClass,
                  "h-16 text-center font-mono text-[1.75rem] font-light tracking-[0.35em] uppercase",
                )}
              />
              <Button type="submit" className="sm:h-16 sm:px-7" disabled={code.trim() === ""}>
                Tekshirish
              </Button>
            </form>

            {pending !== null ? (
              <div className="mt-8 grid gap-6 rounded-[1.5rem] bg-white p-6 shadow-raise">
                <div className="flex items-center gap-4">
                  <IconWell icon={Monitor} />
                  <div className="min-w-0">
                    <div className="truncate text-[1.25rem] font-normal tracking-[-0.02em]">
                      {pending.device_name}
                    </div>
                    <div className="text-[0.95rem] text-ink-3">
                      {pending.os} · akkauntingizga ulanmoqchi
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void decide(true)}>
                    <Check /> Ruxsat berish
                  </Button>
                  <Button variant="secondary" onClick={() => void decide(false)}>
                    <X /> Rad etish
                  </Button>
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="mt-5">
                <Notice ok={false}>{error}</Notice>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
