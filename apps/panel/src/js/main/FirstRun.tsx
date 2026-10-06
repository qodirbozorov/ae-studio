import { useEffect, useState } from "react";
import type { Agent } from "../../agent";
import { ONBOARDING_STEPS, environmentItems } from "../../agent/onboarding";
import type { EnvironmentItem, OnboardingStep } from "../../agent/onboarding";

const HINT: Record<Exclude<OnboardingStep, "done">, string> = {
  connect:
    "Server manzilini kiriting va «Ulash» bosing: brauzerda kabinet ochiladi, kodni tasdiqlang.",
  folder:
    "Videolar uchun ish papkasini tanlang: ichida source/, audio/, out/ papkalari yaratiladi.",
  env: "Panel ffmpeg va aerender'ni tekshirdi. Hammasi joyida bo'lsa «Tayyor» bosing.",
};

/** Birinchi ishga tushirish ustasi (P5.11): ulanish → ish papkasi → muhit tekshiruvi. */
export function FirstRun({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const [step, setStep] = useState<OnboardingStep>(() => agent.onboarding());
  const [items, setItems] = useState<EnvironmentItem[] | null>(null);

  // Ulanish va papka tanlash pastdagi bo'limlarda bo'ladi: qadam har soniyada qayta hisoblanadi.
  useEffect(() => {
    const timer = setInterval(() => setStep(agent.onboarding()), 1000);
    return () => clearInterval(timer);
  }, [agent]);

  useEffect(() => {
    if (step !== "env") return;
    setItems(null);
    void agent
      .environment()
      .then((report) => setItems(environmentItems(report)))
      .catch(() => setItems([{ ok: false, label: "Muhitni tekshirib bo'lmadi" }]));
  }, [agent, step]);

  if (step === "done") return null;
  const index = ONBOARDING_STEPS.findIndex((s) => s.step === step);
  return (
    <section className="dev onboarding" aria-label="Birinchi sozlash">
      <h2>Xush kelibsiz — 3 qadamda sozlaymiz</h2>
      <ol className="steps">
        {ONBOARDING_STEPS.map((s, i) => (
          <li key={s.step} className={i < index ? "done" : i === index ? "current" : undefined}>
            {i < index ? "✅" : i === index ? "👉" : "⬜"} {s.title}
          </li>
        ))}
      </ol>
      <p className="hint">{HINT[step]}</p>
      {step === "env" ? (
        <>
          {items === null ? <p className="hint">Tekshirilmoqda…</p> : null}
          <ul className="recent">
            {(items ?? []).map((item) => (
              <li key={item.label}>
                {item.ok ? "🟢" : "🟡"} {item.label}
                {item.hint !== undefined ? <div className="muted">{item.hint}</div> : null}
              </li>
            ))}
          </ul>
          <div className="buttons">
            <button
              type="button"
              disabled={items === null}
              onClick={() => {
                agent.finishOnboarding();
                setStep("done");
                onDone();
              }}
            >
              Tayyor — Claude'da birinchi videoni so'rang
            </button>
          </div>
          <p className="muted">
            Claude'da: «/new-reel» yoki «/from-template» buyrug'i. Claude'siz: pastdagi Shablonlar.
          </p>
        </>
      ) : null}
    </section>
  );
}
