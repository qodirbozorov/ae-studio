/** Admin → Storage: faol drayver (Railway volume ↔ R2), R2 sozlamasi va fayl explorer. */
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  ChevronRight,
  Cloud,
  Download,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  HardDrive,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import {
  Button,
  Card,
  CardTitle,
  Empty,
  Field,
  Loading,
  Notice,
  PageTitle,
  Pill,
  Segmented,
  Spinner,
  cx,
  inputClass,
} from "../ui";

type Driver = "local" | "s3";

interface CopyStatus {
  running: boolean;
  from: Driver;
  to: Driver;
  prefix: string;
  total: number;
  copied: number;
  skipped: number;
  failed: number;
  error: string | null;
}

interface StorageView {
  active: Driver;
  source: "db" | "env" | "none";
  local_dir: string;
  r2: { endpoint: string; bucket: string; access_key_id: string; secret_masked: string } | null;
  copy: CopyStatus | null;
}

interface BrowseResult {
  prefix: string;
  folders: string[];
  files: { key: string; size: number; modified: string | null }[];
  cursor: string | null;
}

const DRIVER_LABEL: Record<Driver, string> = { local: "Railway volume", s3: "Cloudflare R2" };

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function iconOf(key: string): LucideIcon {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) return FileImage;
  if (["mp3", "wav", "m4a", "ogg", "opus"].includes(ext)) return FileAudio;
  if (["mp4", "mov", "webm"].includes(ext)) return FileVideo;
  if (["json", "md", "txt"].includes(ext)) return FileText;
  return File;
}

const name = (path: string) => path.replace(/\/$/, "").split("/").pop() ?? path;

function ActiveDriver({
  view,
  onChange,
}: {
  view: StorageView;
  onChange: (v: StorageView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (driver: Driver) => {
    if (driver === view.active) return;
    if (
      !window.confirm(
        `Faol storage: ${DRIVER_LABEL[driver]}. Yangi fayllar shu yerga yoziladi; eski fayllar ikkala joydan ham o'qiladi (kerak bo'lsa pastda ko'chiring). Davom etilsinmi?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await api<StorageView>("/api/admin/storage/active", {
      method: "PUT",
      body: JSON.stringify({ driver }),
    });
    setBusy(false);
    if (res.ok) onChange({ ...res.data, copy: view.copy });
    else setError(res.error.message ?? res.error.hint);
  };

  return (
    <Card>
      <CardTitle aside={busy ? <Spinner className="h-5 w-5" /> : null}>Faol storage</CardTitle>
      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          options={[
            { key: "local", label: DRIVER_LABEL.local },
            ...(view.r2 !== null ? [{ key: "s3" as const, label: DRIVER_LABEL.s3 }] : []),
          ]}
          value={view.active}
          onChange={(key) => void choose(key)}
        />
        <span className="text-sm text-ink-3">
          {view.source === "env"
            ? "Sozlama env'dan (admin saqlasa ustidan yoziladi)"
            : view.source === "db"
              ? "Sozlama admin paneldan"
              : "Sukut bo'yicha"}
        </span>
      </div>
      <p className="mt-5 max-w-[65ch] text-[0.95rem] leading-relaxed text-ink-3">
        Yangi fayllar faol storage'ga yoziladi. O'qishda avval faol, topilmasa ikkinchisi
        tekshiriladi — almashtirgandan keyin eski fayllar yo'qolmaydi. Railway volume papkasi:{" "}
        <code>{view.local_dir}</code>
      </p>
      {view.r2 === null ? (
        <p className="mt-3 text-sm text-ink-3">
          R2 ni yoqish uchun avval quyida sozlamalarni saqlang.
        </p>
      ) : null}
      {error !== null ? (
        <div className="mt-4">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

function R2Settings({ view, onChange }: { view: StorageView; onChange: (v: StorageView) => void }) {
  const [endpoint, setEndpoint] = useState(view.r2?.endpoint ?? "");
  const [bucket, setBucket] = useState(view.r2?.bucket ?? "");
  const [accessKey, setAccessKey] = useState(view.r2?.access_key_id ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await api<StorageView>("/api/admin/storage/r2", {
      method: "PUT",
      body: JSON.stringify({
        endpoint,
        bucket,
        access_key_id: accessKey,
        ...(secret.trim() === "" ? {} : { secret_access_key: secret }),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSecret("");
      onChange({ ...res.data, copy: view.copy });
      setMessage({ ok: true, text: "Ulanish tekshirildi va saqlandi" });
    } else {
      setMessage({ ok: false, text: res.error.message ?? res.error.hint });
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        "R2 sozlamasi o'chirilsinmi? Faol storage Railway volume'ga qaytadi. R2 dagi fayllar o'chirilmaydi.",
      )
    )
      return;
    const res = await api<StorageView>("/api/admin/storage/r2", { method: "DELETE" });
    if (res.ok) onChange({ ...res.data, copy: view.copy });
  };

  return (
    <Card>
      <CardTitle
        aside={
          view.r2 !== null ? (
            <Pill tone="go" dot>
              Ulangan
            </Pill>
          ) : (
            <Pill>Sozlanmagan</Pill>
          )
        }
      >
        Cloudflare R2
      </CardTitle>
      <p className="max-w-[65ch] text-[0.95rem] leading-relaxed text-ink-3">
        Cloudflare → R2 → Manage API tokens: Object Read &amp; Write huquqli token. Endpoint:{" "}
        <code>https://&lt;account_id&gt;.r2.cloudflarestorage.com</code>. Maxfiy kalit serverda
        shifrlangan holda saqlanadi va qaytarib ko'rsatilmaydi.
      </p>
      <form onSubmit={(e) => void save(e)} className="mt-6 grid gap-4 md:grid-cols-2">
        <Field label="Endpoint" htmlFor="r2-endpoint">
          <input
            id="r2-endpoint"
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://….r2.cloudflarestorage.com"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Bucket" htmlFor="r2-bucket">
          <input
            id="r2-bucket"
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            placeholder="ae-studio"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Access key ID" htmlFor="r2-access">
          <input
            id="r2-access"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            autoComplete="off"
            className={inputClass}
            required
          />
        </Field>
        <Field label="Secret access key" htmlFor="r2-secret">
          <input
            id="r2-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            placeholder={view.r2 !== null ? `Saqlangan ${view.r2.secret_masked}` : ""}
            className={inputClass}
            required={view.r2 === null}
          />
        </Field>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={busy}>
            <Save /> {busy ? "Tekshirilmoqda…" : "Tekshirish va saqlash"}
          </Button>
          {view.r2 !== null ? (
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 /> O'chirish
            </Button>
          ) : null}
        </div>
        {message !== null ? (
          <div className="md:col-span-2">
            <Notice ok={message.ok}>{message.text}</Notice>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function Explorer({ view, onCopy }: { view: StorageView; onCopy: () => void }) {
  const [driver, setDriver] = useState<Driver>(view.active);
  const [prefix, setPrefix] = useState("");
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const other: Driver = driver === "local" ? "s3" : "local";
  const canCopy = view.r2 !== null && view.copy?.running !== true;

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      const query = new URLSearchParams({ driver, prefix });
      if (cursor !== undefined) query.set("cursor", cursor);
      const res = await api<BrowseResult>(`/api/admin/storage/browse?${query.toString()}`);
      setLoading(false);
      if (!res.ok) {
        setError(res.error.message ?? res.error.hint);
        return;
      }
      setData((previous) =>
        cursor !== undefined && previous !== null
          ? {
              ...res.data,
              folders: previous.folders,
              files: [...previous.files, ...res.data.files],
            }
          : res.data,
      );
    },
    [driver, prefix],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (key: string) => {
    if (!window.confirm(`O'chirilsinmi?\n${key}`)) return;
    const res = await api(
      `/api/admin/storage/object?${new URLSearchParams({ driver, key }).toString()}`,
      {
        method: "DELETE",
      },
    );
    if (res.ok) void load();
    else setError(res.error.message ?? res.error.hint);
  };

  const removeFolder = async () => {
    if (
      !window.confirm(
        `Papka va ichidagi BARCHA fayllar o'chirilsinmi?\n${DRIVER_LABEL[driver]}: ${prefix}`,
      )
    )
      return;
    const res = await api<{ deleted: number }>(
      `/api/admin/storage/folder?${new URLSearchParams({ driver, prefix }).toString()}`,
      { method: "DELETE" },
    );
    if (res.ok)
      setPrefix(
        prefix
          .split("/")
          .slice(0, -2)
          .join("/")
          .replace(/^(.+)$/, "$1/"),
      );
    else setError(res.error.message ?? res.error.hint);
  };

  const copy = async () => {
    if (
      !window.confirm(
        `${prefix === "" ? "Barcha fayllar" : prefix} → ${DRIVER_LABEL[other]} ga ko'chirilsinmi? U yerda borlari o'tkaziladi, hech narsa o'chirilmaydi.`,
      )
    )
      return;
    const res = await api("/api/admin/storage/copy", {
      method: "POST",
      body: JSON.stringify({ from: driver, to: other, prefix }),
    });
    if (res.ok) onCopy();
    else setError(res.error.message ?? res.error.hint);
  };

  const crumbs = prefix === "" ? [] : prefix.slice(0, -1).split("/");

  return (
    <Card>
      <CardTitle
        aside={
          view.r2 !== null ? (
            <Segmented
              options={[
                { key: "local", label: DRIVER_LABEL.local },
                { key: "s3", label: DRIVER_LABEL.s3 },
              ]}
              value={driver}
              onChange={(key) => {
                setDriver(key);
                setPrefix("");
              }}
            />
          ) : null
        }
      >
        Fayllar
      </CardTitle>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Joylashuv"
          className="flex min-w-0 flex-wrap items-center gap-1 text-[0.95rem]"
        >
          <button
            type="button"
            onClick={() => setPrefix("")}
            className="flex cursor-pointer items-center gap-1.5 rounded-[0.7rem] px-2 py-1 text-ink-2 hover:bg-well hover:text-ink"
          >
            {driver === "local" ? <HardDrive className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
            {DRIVER_LABEL[driver]}
          </button>
          {crumbs.map((part, i) => (
            <span key={`${part}-${i}`} className="flex items-center gap-1">
              <ChevronRight className="h-4 w-4 text-ink-4" />
              <button
                type="button"
                onClick={() => setPrefix(`${crumbs.slice(0, i + 1).join("/")}/`)}
                className="max-w-[14rem] cursor-pointer truncate rounded-[0.7rem] px-2 py-1 text-ink-2 hover:bg-well hover:text-ink"
              >
                {part}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            <RefreshCw className={loading ? "animate-spin" : undefined} /> Yangilash
          </Button>
          {canCopy ? (
            <Button size="sm" variant="secondary" onClick={() => void copy()}>
              <ArrowLeftRight /> {DRIVER_LABEL[other]} ga ko'chirish
            </Button>
          ) : null}
          {prefix !== "" ? (
            <Button size="sm" variant="danger" onClick={() => void removeFolder()}>
              <Trash2 /> Papkani o'chirish
            </Button>
          ) : null}
        </div>
      </div>

      {error !== null ? (
        <div className="mt-4">
          <Notice ok={false}>{error}</Notice>
        </div>
      ) : null}
      {data === null ? <Loading /> : null}
      {data !== null && data.folders.length === 0 && data.files.length === 0 ? (
        <Empty>Bo'sh papka.</Empty>
      ) : null}

      {data !== null ? (
        <ul className="mt-4 divide-y divide-hair">
          {data.folders.map((folder) => (
            <li key={folder}>
              <button
                type="button"
                onClick={() => setPrefix(folder)}
                className="-mx-3 flex w-[calc(100%+1.5rem)] cursor-pointer items-center gap-3 rounded-[0.9rem] px-3 py-2.5 text-left transition-colors hover:bg-well/70"
              >
                <Folder className="h-5 w-5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-[0.98rem] font-normal">
                  {name(folder)}
                </span>
                <ChevronRight className="h-4 w-4 text-ink-4" />
              </button>
            </li>
          ))}
          {data.files.map((file) => {
            const Icon = iconOf(file.key);
            const href = `/api/admin/storage/download?${new URLSearchParams({ driver, key: file.key }).toString()}`;
            return (
              <li key={file.key} className="flex flex-wrap items-center gap-3 py-2.5">
                <Icon className="h-5 w-5 shrink-0 text-ink-3" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[0.85rem]" title={file.key}>
                    {name(file.key)}
                  </div>
                  <div className="num text-xs text-ink-3">
                    {size(file.size)}
                    {file.modified !== null
                      ? ` · ${new Date(file.modified).toLocaleString("uz-UZ")}`
                      : ""}
                  </div>
                </div>
                <div className="flex gap-1">
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    title="Ochish / yuklab olish"
                    aria-label={`Ochish: ${name(file.key)}`}
                    className="flex h-9 w-9 items-center justify-center rounded-[0.8rem] text-ink-2 hover:bg-well hover:text-ink"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => void remove(file.key)}
                    title="O'chirish"
                    aria-label={`O'chirish: ${name(file.key)}`}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[0.8rem] text-stop hover:bg-stop-soft"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {data?.cursor ? (
        <div className="mt-4">
          <Button size="sm" variant="secondary" onClick={() => void load(data.cursor!)}>
            Ko'proq ko'rsatish
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function CopyProgress({ copy }: { copy: CopyStatus }) {
  const done = copy.copied + copy.skipped + copy.failed;
  const percent =
    copy.total === 0 ? (copy.running ? 0 : 100) : Math.round((done / copy.total) * 100);
  return (
    <Card>
      <CardTitle
        aside={
          copy.running ? (
            <Pill tone="live" dot>
              Ko'chirilmoqda
            </Pill>
          ) : (
            <Pill tone="go">Tugadi</Pill>
          )
        }
      >
        Ko'chirish
      </CardTitle>
      <div className="text-[0.95rem] text-ink-2">
        {DRIVER_LABEL[copy.from]} → {DRIVER_LABEL[copy.to]} · <code>{copy.prefix || "/"}</code>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-well" aria-hidden="true">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="num mt-3 text-sm text-ink-3">
        {done}/{copy.total} · ko'chirildi {copy.copied} · bor edi {copy.skipped}
        {copy.failed > 0 ? <span className="text-stop"> · xato {copy.failed}</span> : null}
      </div>
      {copy.error !== null ? (
        <div className="mt-3">
          <Notice ok={false}>{copy.error}</Notice>
        </div>
      ) : null}
    </Card>
  );
}

export function StoragePage() {
  const [view, setView] = useState<StorageView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<StorageView>("/api/admin/storage");
    if (res.ok) setView(res.data);
    else setError(res.error.message ?? res.error.hint);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Ko'chirish davom etayotganda holatni yangilab turish.
  useEffect(() => {
    if (view?.copy?.running !== true) return;
    const timer = setInterval(() => void load(), 1500);
    return () => clearInterval(timer);
  }, [view?.copy?.running, load]);

  return (
    <>
      <PageTitle title="Storage" muted="va fayllar" />
      {error !== null ? <Notice ok={false}>{error}</Notice> : null}
      {view === null && error === null ? <Loading /> : null}
      {view !== null ? (
        <div className={cx("grid grid-cols-1 gap-6")}>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <ActiveDriver view={view} onChange={setView} />
            <R2Settings view={view} onChange={setView} />
          </div>
          {view.copy !== null ? <CopyProgress copy={view.copy} /> : null}
          <Explorer view={view} onCopy={() => void load()} />
        </div>
      ) : null}
    </>
  );
}
