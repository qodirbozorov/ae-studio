/** Admin → Narxlar (P9.03–P9.04): tarif paketlari, narx stavkalari va to'lov kontakti. */
import { Check, Pencil, Plus, Save, Tag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, post } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Field,
  IconWell,
  Loading,
  Notice,
  PageTitle,
  Pill,
  cx,
  inputClass,
} from "../ui";
import { usd } from "./UsersPage";
import type { Tariff } from "./UsersPage";

interface Rates {
  markup: number;
  basicRatio: number;
  cachedRatio: number;
  timelinePerMinute: number;
  activationUsd: number;
  cost: Record<CostKey, number>;
}

type CostKey =
  | "ttsPer1kChars"
  | "ttsFlashPer1kChars"
  | "musicPerMinute"
  | "sfxPerMinute"
  | "sttPerHour"
  | "isolatePerMinute"
  | "voiceChangePerMinute"
  | "dubPerMinute";

type TopKey = "markup" | "basicRatio" | "cachedRatio" | "timelinePerMinute" | "activationUsd";

interface Pricing {
  defaults: Rates;
  rates: Rates;
  overrides: Partial<Omit<Rates, "cost">> & { cost?: Partial<Rates["cost"]> };
  contact: string | null;
  enforced: boolean;
}

const TOP: { key: TopKey; label: string; hint: string }[] = [
  { key: "markup", label: "Pro ustamasi (×)", hint: "Tannarx × shu (1,2 × 2 = 2,4)" },
  { key: "basicRatio", label: "Oddiy / pro nisbati", hint: "0,1 — standart variant 10× arzon" },
  { key: "cachedRatio", label: "Kesh koeffitsienti", hint: "0,5 — keshdan olingani yarim narx" },
  { key: "timelinePerMinute", label: "Montaj, $ / daqiqa", hint: "Job uchun bir marta" },
  { key: "activationUsd", label: "Boshlang'ich to'lov, $", hint: "Shundan keyin faollashadi" },
];

const COST: { key: CostKey; label: string }[] = [
  { key: "ttsPer1kChars", label: "TTS, $ / 1000 belgi" },
  { key: "ttsFlashPer1kChars", label: "TTS Flash, $ / 1000 belgi" },
  { key: "musicPerMinute", label: "Musiqa, $ / daqiqa" },
  { key: "sfxPerMinute", label: "SFX, $ / daqiqa" },
  { key: "sttPerHour", label: "Transkripsiya, $ / soat" },
  { key: "isolatePerMinute", label: "Ovoz tozalash, $ / daqiqa" },
  { key: "voiceChangePerMinute", label: "Ovoz almashtirish, $ / daqiqa" },
  { key: "dubPerMinute", label: "Dublyaj, $ / daqiqa" },
];

const num = (text: string): number | undefined => {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
};

function RatesCard() {
  const [data, setData] = useState<Pricing | null>(null);
  const [top, setTop] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fill = (pricing: Pricing) => {
    setData(pricing);
    const o = pricing.overrides;
    setTop(
      Object.fromEntries(TOP.map(({ key }) => [key, o[key] === undefined ? "" : String(o[key])])),
    );
    setCost(
      Object.fromEntries(
        COST.map(({ key }) => [key, o.cost?.[key] === undefined ? "" : String(o.cost[key])]),
      ),
    );
    setContact(pricing.contact ?? "");
  };

  useEffect(() => {
    void api<Pricing>("/api/admin/pricing").then((res) => res.ok && fill(res.data));
  }, []);

  if (data === null) return <Loading />;

  // Kiritilayotgan qiymatlar bo'yicha mijoz narxi (saqlashdan oldin ko'rish uchun).
  const value = (key: TopKey) => num(top[key] ?? "") ?? data.defaults[key];
  const costOf = (key: CostKey) => num(cost[key] ?? "") ?? data.defaults.cost[key];
  const preview = [
    ["Pro musiqa / daq", costOf("musicPerMinute") * value("markup")],
    ["Kutubxona musiqasi / daq", costOf("musicPerMinute") * value("markup") * value("basicRatio")],
    ["Pro tozalash / daq", costOf("isolatePerMinute") * value("markup")],
    ["Standart tozalash / daq", costOf("isolatePerMinute") * value("markup") * value("basicRatio")],
    ["TTS / 1000 belgi", costOf("ttsPer1kChars")],
    ["Montaj / daq", value("timelinePerMinute")],
  ] as const;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const rates: Record<string, unknown> = {};
    for (const { key } of TOP) {
      const v = num(top[key] ?? "");
      if (v !== undefined) rates[key] = v;
    }
    const costPatch: Record<string, number> = {};
    for (const { key } of COST) {
      const v = num(cost[key] ?? "");
      if (v !== undefined) costPatch[key] = v;
    }
    if (Object.keys(costPatch).length > 0) rates.cost = costPatch;
    const invalid = Object.values({ ...rates, ...costPatch }).some(
      (v) => typeof v === "number" && Number.isNaN(v),
    );
    if (invalid) {
      setMessage({ ok: false, text: "Raqam noto'g'ri kiritilgan" });
      return;
    }
    if (!window.confirm("Yangi narxlar darhol barcha foydalanuvchilarga qo'llanadi. Saqlansinmi?"))
      return;
    setBusy(true);
    const res = await api<Pricing>("/api/admin/pricing", {
      method: "PUT",
      body: JSON.stringify({
        ...(Object.keys(rates).length === 0 ? {} : { rates }),
        ...(contact.trim() === "" ? {} : { contact: contact.trim() }),
      }),
    });
    setBusy(false);
    if (res.ok) {
      fill(res.data);
      setMessage({ ok: true, text: "Saqlandi" });
    } else setMessage({ ok: false, text: res.error.message ?? res.error.hint });
  };

  const input = (
    id: string,
    current: string,
    placeholder: number,
    onChange: (text: string) => void,
  ) => (
    <input
      id={id}
      inputMode="decimal"
      value={current}
      onChange={(e) => onChange(e.target.value)}
      placeholder={String(placeholder)}
      className={cx(inputClass, current !== "" && "border-ink-4")}
    />
  );

  return (
    <Card>
      <CardTitle
        aside={
          <Pill tone={data.enforced ? "go" : "wait"}>
            {data.enforced ? "Cheklov yoqilgan" : "Cheklov o'chiq (faqat yoziladi)"}
          </Pill>
        }
      >
        Stavkalar
      </CardTitle>
      <p className="mb-6 max-w-[70ch] text-sm leading-relaxed text-ink-3">
        Bo'sh maydon — koddagi qiymat (kulrang). O'zgartirilgani ajratib ko'rsatiladi. Saqlash
        darhol qo'llanadi; boshqa server nusxalari 30 soniya ichida oladi. Har o'zgarish audit'da.
      </p>
      <form onSubmit={(e) => void save(e)} className="grid gap-8">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TOP.map(({ key, label, hint }) => (
            <Field key={key} label={label} htmlFor={`rate-${key}`}>
              {input(`rate-${key}`, top[key] ?? "", data.defaults[key], (text) =>
                setTop((s) => ({ ...s, [key]: text })),
              )}
              <span className="text-xs text-ink-3">{hint}</span>
            </Field>
          ))}
        </div>
        <div>
          <h3 className="mb-4 text-lg font-normal">Tannarx (tashqi xizmat)</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {COST.map(({ key, label }) => (
              <Field key={key} label={label} htmlFor={`cost-${key}`}>
                {input(`cost-${key}`, cost[key] ?? "", data.defaults.cost[key], (text) =>
                  setCost((s) => ({ ...s, [key]: text })),
                )}
              </Field>
            ))}
          </div>
        </div>
        <Field label="To'lov uchun murojaat (kabinet va botda ko'rinadi)" htmlFor="pay-contact">
          <input
            id="pay-contact"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="@admin yoki +998 …"
            maxLength={200}
            className={inputClass}
          />
        </Field>
        <div className="rounded-[1.25rem] bg-well p-5">
          <div className="mb-3 text-sm text-ink-2">Mijoz narxi (shu qiymatlar bilan)</div>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {preview.map(([label, price]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-ink-3">{label}</dt>
                <dd className="num">{Number.isNaN(price) ? "—" : usd(price, 4)}</dd>
              </div>
            ))}
          </dl>
        </div>
        {message !== null ? <Notice ok={message.ok}>{message.text}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            <Save /> {busy ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setTop({});
              setCost({});
            }}
          >
            Hammasini koddagi qiymatga
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface TariffForm {
  name: string;
  description: string;
  price: string;
  credit: string;
  sort: string;
}

const emptyForm: TariffForm = { name: "", description: "", price: "", credit: "", sort: "0" };

function TariffEditor({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial: TariffForm;
  onSubmit: (body: Record<string, unknown>) => Promise<string | null>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof TariffForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const price = num(form.price);
    const credit = num(form.credit) ?? price;
    if (
      price === undefined ||
      Number.isNaN(price) ||
      credit === undefined ||
      Number.isNaN(credit)
    ) {
      setError("To'lov va balansga summa raqam bo'lsin");
      return;
    }
    const message = await onSubmit({
      name: form.name.trim(),
      description: form.description.trim(),
      price_usd: price,
      credit_usd: credit,
      sort: Number.parseInt(form.sort, 10) || 0,
    });
    setError(message);
    if (message === null && onCancel === undefined) setForm(emptyForm);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-[1.2fr_0.7fr_0.7fr_0.4fr]">
        <input
          aria-label="Nomi"
          value={form.name}
          onChange={set("name")}
          placeholder="Nomi (Start, Pro…)"
          className={cx(inputClass, "py-2")}
          required
          maxLength={80}
        />
        <input
          aria-label="To'lov, $"
          inputMode="decimal"
          value={form.price}
          onChange={set("price")}
          placeholder="To'lov, $"
          className={cx(inputClass, "py-2")}
          required
        />
        <input
          aria-label="Balansga, $"
          inputMode="decimal"
          value={form.credit}
          onChange={set("credit")}
          placeholder="Balansga, $ (bonus bilan)"
          className={cx(inputClass, "py-2")}
        />
        <input
          aria-label="Tartib"
          inputMode="numeric"
          value={form.sort}
          onChange={set("sort")}
          placeholder="Tartib"
          className={cx(inputClass, "py-2")}
        />
      </div>
      <input
        aria-label="Izoh"
        value={form.description}
        onChange={set("description")}
        placeholder="Izoh (kabinetda ko'rinadi)"
        className={cx(inputClass, "py-2")}
        maxLength={500}
      />
      {error !== null ? <Notice ok={false}>{error}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {onCancel === undefined ? <Plus /> : <Check />} {submitLabel}
        </Button>
        {onCancel !== undefined ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X /> Bekor
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function TariffsCard() {
  const [rows, setRows] = useState<Tariff[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ tariffs: Tariff[] }>("/api/admin/tariffs");
    if (res.ok) setRows(res.data.tariffs);
    else setError(res.error.message ?? res.error.hint);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (body: Record<string, unknown>) => {
    const res = await post<Tariff>("/api/admin/tariffs", body);
    if (!res.ok) return res.error.message ?? res.error.hint;
    void load();
    return null;
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await api<Tariff>(`/api/admin/tariffs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) return res.error.message ?? res.error.hint;
    setEditing(null);
    void load();
    return null;
  };

  const remove = async (tariff: Tariff) => {
    if (
      !window.confirm(`«${tariff.name}» o'chirilsinmi? (O'tgan to'ldirishlar izohida nomi qoladi)`)
    )
      return;
    const res = await api(`/api/admin/tariffs/${tariff.id}`, { method: "DELETE" });
    if (res.ok) void load();
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <Card className="mb-6">
      <CardTitle aside={<IconWell icon={Tag} />}>Tariflar</CardTitle>
      <p className="mb-6 max-w-[70ch] text-sm leading-relaxed text-ink-3">
        Paket: foydalanuvchi «to'lov» summasini to'laydi, balansga «balansga» summasi yoziladi
        (farqi — bonus). To'lovni qabul qilgach, foydalanuvchi profilida tarifni tanlab balansni
        to'ldiring. Faol tariflar kabinetda ko'rinadi.
      </p>
      {error !== null ? <Notice ok={false}>{error}</Notice> : null}
      {rows === null ? (
        <Loading />
      ) : (
        <ul className="mb-6 grid gap-3">
          {rows.map((t) => (
            <li key={t.id} className="rounded-[1.1rem] bg-white p-4 shadow-raise">
              {editing === t.id ? (
                <TariffEditor
                  initial={{
                    name: t.name,
                    description: t.description,
                    price: String(t.price_usd),
                    credit: String(t.credit_usd),
                    sort: String(t.sort),
                  }}
                  submitLabel="Saqlash"
                  onSubmit={(body) => patch(t.id, body)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[1.05rem]">
                      {t.name}
                      {!t.active ? <Pill>Nofaol</Pill> : null}
                      {t.bonus_usd > 0 ? <Pill tone="go">+{usd(t.bonus_usd)} bonus</Pill> : null}
                    </div>
                    <div className="mt-1 text-sm text-ink-3">
                      To'lov {usd(t.price_usd)} → balansga {usd(t.credit_usd)}
                      {t.description !== "" ? ` · ${t.description}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void patch(t.id, { active: !t.active })}
                    >
                      {t.active ? "O'chirish" : "Yoqish"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Tahrirlash"
                      onClick={() => setEditing(t.id)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label="O'chirish"
                      onClick={() => void remove(t)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <TariffEditor initial={emptyForm} submitLabel="Tarif qo'shish" onSubmit={create} />
    </Card>
  );
}

export function PricingPage() {
  return (
    <>
      <PageTitle title="Narxlar" muted="va tariflar" />
      <TariffsCard />
      <RatesCard />
    </>
  );
}
