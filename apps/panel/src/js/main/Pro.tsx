/** Sozlama → Pro (P8.09): Pro musiqa va Pro ovoz tozalash, narx eslatmasi bilan. Serverda saqlanadi. */
import { Sparkles, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import type { Agent, PanelBilling } from "../../agent";

const usd = (value: number) => `${value < 0.01 ? value.toFixed(4) : value.toFixed(2)} $`;

/** Balans (status pill va Pro bo'limi uchun): ulanganda va har daqiqada yangilanadi. */
export function useBilling(agent: Agent, connected: boolean) {
  const [billing, setBilling] = useState<PanelBilling | null>(null);
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = () =>
      void agent.billing().then((value) => {
        if (alive) setBilling(value);
      });
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [agent, connected]);
  return [billing, setBilling] as const;
}

export function ProSettings({ agent, connected }: { agent: Agent; connected: boolean }) {
  const [billing, setBilling] = useBilling(agent, connected);
  const [busy, setBusy] = useState(false);

  const toggle = async (key: "pro_music" | "pro_isolation", value: boolean) => {
    if (billing === null) return;
    if (value) {
      const text =
        key === "pro_music"
          ? `Pro musiqa: kutubxonada mos trek bo'lmasa yangi musiqa generatsiya qilinadi — ${usd(billing.prices.music_pro_per_min)}/daq (kutubxona: ${usd(billing.prices.music_library_per_min)}/daq). Claude har safar so'ramaydi. Yoqilsinmi?`
          : `Pro ovoz tozalash: ${usd(billing.prices.isolation_pro_per_min)}/daq (standart: ${usd(billing.prices.isolation_standard_per_min)}/daq). Claude har safar so'ramaydi. Yoqilsinmi?`;
      if (!window.confirm(text)) return;
    }
    setBusy(true);
    const next = await agent.setPreferences({ [key]: value });
    setBusy(false);
    if (next !== null) setBilling(next);
  };

  return (
    <section className="dev" aria-label="Pro">
      <h2>Balans va Pro</h2>
      {billing === null ? (
        <p className="hint">{connected ? "Yuklanmoqda…" : "Serverga ulaning."}</p>
      ) : (
        <>
          <div className="figure-row">
            <div className="figure">
              {billing.balance_usd.toFixed(2)}
              <small>$</small>
            </div>
            <span className={billing.activated ? "state-pill go" : "state-pill wait"}>
              <Wallet size={13} />
              {billing.activated ? "Faol" : `${billing.activation_usd} $ to'lov kerak`}
            </span>
          </div>
          {(
            [
              {
                key: "pro_music",
                title: "Pro musiqa",
                text: `Yangi musiqa generatsiyasi — ${usd(billing.prices.music_pro_per_min)}/daq. O'chiq bo'lsa Claude narxni aytib so'raydi.`,
              },
              {
                key: "pro_isolation",
                title: "Pro ovoz tozalash",
                text: `${usd(billing.prices.isolation_pro_per_min)}/daq. Standart (serverda): ${usd(billing.prices.isolation_standard_per_min)}/daq.`,
              },
            ] as const
          ).map((row) => (
            <div key={row.key} className="pro-row">
              <div className="pro-text">
                <div className="row-title">
                  <Sparkles size={14} className="dim-icon" />
                  <b>{row.title}</b>
                </div>
                <div className="muted">{row.text}</div>
                {billing[row.key] ? (
                  <div className="warn-note">Yoqilgan: balansdan ko'proq yechiladi</div>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={billing[row.key]}
                aria-label={row.title}
                disabled={busy}
                className={`switch${billing[row.key] ? " on" : ""}`}
                onClick={() => void toggle(row.key, !billing[row.key])}
              >
                <span />
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
