/** Kabinet uchun umumiy UI bo'laklari: kartalar, tugmalar, pill'lar, holat nishonlari, vaqt. */
import type { LucideIcon } from "lucide-react";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("uz-UZ") : "—";
}

const MONTHS = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

/** "12-oktabr, 2026" (brauzerlar uz-UZ oy nomlarini bir xil chiqarmaydi). */
export function day(value: string): string {
  const d = new Date(value);
  return `${d.getDate()}-${MONTHS[d.getMonth()]}, ${d.getFullYear()}`;
}

/** "3 daqiqa oldin" ko'rinishi. */
export function ago(value: string | null | undefined): string {
  if (!value) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (s < 60) return "hozirgina";
  if (s < 3600) return `${Math.floor(s / 60)} daqiqa oldin`;
  if (s < 86_400) return `${Math.floor(s / 3600)} soat oldin`;
  return `${Math.floor(s / 86_400)} kun oldin`;
}

/** AE Studio belgisi (public/ae-studio-full.svg — "Ae Studio" vordmarki, ae-studio-icon.svg — faqat "Ae"). */
export function Logo({ icon = false, className }: { icon?: boolean; className?: string }) {
  return (
    <img
      src={icon ? "/ae-studio-icon.svg" : "/ae-studio-full.svg"}
      alt="AE Studio"
      width={icon ? 268 : 690}
      height={268}
      draggable={false}
      className={cx("block w-auto select-none", className)}
    />
  );
}

/** Katta "overview" kartasi. */
export function Card({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cx("surface min-w-0 p-6 sm:p-10", className)}>
      {children}
    </section>
  );
}

/** Ikki tonli sahifa sarlavhasi: "Qurilmalar holati". */
export function PageTitle({
  title,
  muted,
  action,
}: {
  title: string;
  muted?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 sm:mb-10">
      <h1 className="text-[2.25rem] leading-[1.05] font-light tracking-[-0.035em] text-balance sm:text-[3.25rem]">
        {title}
        {muted ? <span className="text-[#858585]"> {muted}</span> : null}
      </h1>
      {action}
    </div>
  );
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[1.6rem] leading-tight font-normal tracking-[-0.025em]">{children}</h2>
      {aside}
    </div>
  );
}

/** Kichik yorliq (karta ichidagi bo'lim nomi). */
export function Label({ children, icon: Icon }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="text-lg leading-snug font-normal tracking-[-0.015em] break-words text-ink-2">
      {children}
      {Icon ? (
        <Icon className="ml-2 inline-block h-5 w-5 align-[-0.2em] text-ink-4" aria-hidden="true" />
      ) : null}
    </div>
  );
}

/** Katta ingichka raqam: "64%". */
export function Figure({
  value,
  prefix,
  suffix,
}: {
  value: ReactNode;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="num flex items-baseline text-[4rem] leading-none font-extralight tracking-[-0.03em] sm:text-[4.75rem]">
      {prefix ? <span className="text-ink-4">{prefix}</span> : null}
      <span>{value}</span>
      {suffix ? (
        <span className="ml-1 text-[0.45em] tracking-[-0.02em] text-ink-4">{suffix}</span>
      ) : null}
    </div>
  );
}

/** Aylana ikon qudug'i. */
export function IconWell({
  icon: Icon,
  size = "md",
}: {
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
}) {
  const box = { sm: "h-11 w-11", md: "h-16 w-16", lg: "h-24 w-24" }[size];
  const glyph = { sm: "h-5 w-5", md: "h-6 w-6", lg: "h-8 w-8" }[size];
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-well text-ink-2",
        box,
      )}
    >
      <Icon className={glyph} />
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black active:bg-black",
  secondary: "bg-white text-ink shadow-raise hover:bg-[#fafafa] active:shadow-none",
  ghost: "text-ink-2 hover:bg-well hover:text-ink",
  danger: "text-stop hover:bg-stop-soft",
};
const SIZE: Record<Size, string> = {
  sm: "h-9 gap-1.5 rounded-[0.85rem] px-3.5 text-sm",
  md: "h-11 gap-2 rounded-pill px-5 text-[0.95rem]",
};

function buttonClass(variant: Variant, size: Size, className?: string): string {
  return cx(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-normal whitespace-nowrap no-underline transition-[background-color,box-shadow,color] duration-200 ease-out",
    "disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:h-4 [&_svg]:w-4",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

export type Tone = "go" | "wait" | "stop" | "live" | "neutral";

const TONE: Record<Tone, string> = {
  go: "border-mint-line bg-mint-soft text-go",
  wait: "border-[#f5d5c2] bg-peach-soft text-peach-ink",
  stop: "border-stop-line bg-stop-soft text-stop",
  live: "border-transparent bg-white text-ink shadow-raise",
  neutral: "border-transparent bg-well text-ink-2",
};

/** Holat pill'i: "↑ 36.8%" uslubida chiziqli yumshoq to'rtburchak. */
export function Pill({
  tone = "neutral",
  icon: Icon,
  dot,
  children,
  title,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-8 max-w-full items-center gap-1.5 rounded-[0.8rem] border px-3 text-sm font-normal whitespace-nowrap",
        TONE[tone],
      )}
    >
      {dot ? (
        <span
          className={cx(
            "h-1.5 w-1.5 shrink-0 rounded-full bg-current",
            (tone === "go" || tone === "live") && "animate-breathe",
          )}
        />
      ) : null}
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Pastel hisoblagich (nav'dagi "3", "8"). */
export function Count({
  tone = "peach",
  children,
}: {
  tone?: "peach" | "mint" | "neutral";
  children: ReactNode;
}) {
  const color = {
    peach: "bg-peach text-peach-ink",
    mint: "bg-mint text-mint-ink",
    neutral: "bg-well text-ink-2",
  }[tone];
  return (
    <span
      className={cx(
        "num inline-flex h-7 min-w-7 items-center justify-center rounded-[0.65rem] px-2 text-[0.8rem] font-medium",
        color,
      )}
    >
      {children}
    </span>
  );
}

/** Kichik ma'lumot qatori: ikon + matn. */
export function Meta({
  icon: Icon,
  children,
  title,
}: {
  icon: LucideIcon;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 text-[0.95rem] text-ink-3" title={title}>
      <Icon className="h-4 w-4 shrink-0 text-ink-4" />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** Segmentli filtr (tablar). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex max-w-full overflow-x-auto rounded-[1rem] bg-well p-1 [scrollbar-width:none]"
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={cx(
            "h-8 cursor-pointer rounded-[0.75rem] px-3.5 text-sm font-normal transition-[background-color,box-shadow,color] duration-200",
            value === o.key ? "bg-white text-ink shadow-raise" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputClass =
  "w-full rounded-[1rem] border border-hair bg-white px-4 py-3 text-base sm:text-[0.95rem] font-normal text-ink outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-light focus:border-ink-4 focus:shadow-[0_0_0_4px_rgb(0_0_0/0.05)]";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={htmlFor} className="text-sm font-normal text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Natija yoki xato xabari. */
export function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role={ok ? "status" : "alert"}
      className={cx(
        "flex items-start gap-2 rounded-[1rem] px-4 py-3 text-sm font-normal",
        ok ? "bg-mint-soft text-mint-ink" : "bg-stop-soft text-stop",
      )}
    >
      {ok ? (
        <CircleCheck className="mt-px h-4 w-4 shrink-0" />
      ) : (
        <CircleX className="mt-px h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Yuklanmoqda"
      className={cx(
        "inline-block animate-spin rounded-full border-[1.5px] border-line border-t-ink-2",
        className,
      )}
    />
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="mx-auto max-w-md py-8 text-center text-[0.95rem] text-ink-3">{children}</p>;
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  CHECK: { label: "Tekshiruv", tone: "live" },
  PLAN: { label: "Reja", tone: "live" },
  INGEST: { label: "Fayllar", tone: "live" },
  AUDIO: { label: "Audio", tone: "live" },
  PREFLIGHT: { label: "Tayyorlov", tone: "live" },
  BUILD: { label: "Qurilmoqda", tone: "live" },
  VERIFY: { label: "Tekshiruvda", tone: "wait" },
  RENDER: { label: "Render", tone: "live" },
  REPORT: { label: "Hisobot", tone: "live" },
  DONE: { label: "Tayyor", tone: "go" },
  BLOCKED: { label: "To'xtagan", tone: "stop" },
  WAITING_AGENT: { label: "Panel kutilmoqda", tone: "wait" },
};

export function stateOf(state: string, outcome?: string | null): { label: string; tone: Tone } {
  if (state === "DONE" && outcome === "cancelled")
    return { label: "Bekor qilindi", tone: "neutral" };
  if (state === "DONE" && outcome === "failed") return { label: "Xato", tone: "stop" };
  return STATE[state] ?? { label: state, tone: "neutral" };
}

export function StateBadge({ state, outcome }: { state: string; outcome?: string | null }) {
  const s = stateOf(state, outcome);
  return (
    <Pill tone={s.tone} dot={s.tone === "live" || s.tone === "go"}>
      {s.label}
    </Pill>
  );
}

export function OnlineBadge({ online, revoked }: { online: boolean; revoked?: boolean }) {
  if (revoked) return <Pill tone="stop">Bekor qilingan</Pill>;
  return online ? (
    <Pill tone="go" dot>
      Onlayn
    </Pill>
  ) : (
    <Pill tone="neutral">Oflayn</Pill>
  );
}

const LEVEL: Record<string, { icon: LucideIcon; tone: string }> = {
  info: { icon: CircleCheck, tone: "text-ink-4" },
  warn: { icon: CircleAlert, tone: "text-[#c7702f]" },
  error: { icon: CircleX, tone: "text-stop" },
  debug: { icon: Info, tone: "text-ink-4" },
};

export function LevelIcon({ level }: { level: string }) {
  const l = LEVEL[level] ?? LEVEL.info!;
  const Icon = l.icon;
  return <Icon className={`h-4 w-4 shrink-0 ${l.tone}`} />;
}

/** Job hodisasi turi → tushunarli sarlavha. */
const EVENT: Record<string, string> = {
  "job.created": "Job yaratildi",
  "job.state": "Holat o'zgardi",
  "job.blocked": "To'xtadi",
  "job.patched": "Reja yangilandi",
  "check.env": "Muhit tekshirildi",
  "check.folder_restored": "Ish papkasi tiklandi",
  "plan.ok": "Reja qabul qilindi",
  "ingest.done": "Fayllar o'qildi",
  "preflight.ok": "Qurishga tayyor",
  "preflight.warning": "Ogohlantirish",
  "build.resume": "Qurish davom etdi",
  "build.done": "Qurish tugadi",
  "scene.done": "Sahna qurildi",
  "op.failed": "Amal bajarilmadi",
  "op.undone": "Amal bekor qilindi",
  "script.result": "Skript",
  "verify.waiting": "Tekshiruv kutilmoqda",
  "verify.approved": "Tasdiqlandi",
  "verify.contact_sheet": "Kadrlar ko'rildi",
  "verify.frames": "Kadrlar olindi",
  "verify.reason": "Tuzatish sababi",
  "render.started": "Render boshlandi",
  "render.done": "Render tugadi",
  "render.failed": "Render xatosi",
  "agent.waiting": "Panel kutilmoqda",
  "agent.back": "Panel qayta ulandi",
  "audio.ready": "Audio tayyor",
  "audio.skipped": "Audio yo'q",
  "file.copy_failed": "Fayl yuborilmadi",
};

export function eventTitle(type: string): string {
  return EVENT[type] ?? type;
}
