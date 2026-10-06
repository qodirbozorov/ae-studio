/**
 * Postgres sxemasi — ae-studio-plan.md §5 (17 jadval).
 * Yagona haqiqat manbai `jobs` + `job_events` (§2.1). Holat enum'lari `@aes/shared` dan olinadi.
 */
import { JOB_OUTCOMES, JOB_STATES, LOG_LEVELS } from "@aes/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------- enum'lar

export const jobStateEnum = pgEnum("job_state", JOB_STATES);
export const jobOutcomeEnum = pgEnum("job_outcome", JOB_OUTCOMES);
export const logLevelEnum = pgEnum("log_level", LOG_LEVELS);
export const opStatusEnum = pgEnum("op_status", [
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "queued",
  "running",
  "done",
  "failed",
  "skipped",
]);
export const tokenKindEnum = pgEnum("token_kind", [
  "session",
  "magic_link",
  "device_code",
  "device",
  "auth_code",
  "access",
  "refresh",
]);
export const assetKindEnum = pgEnum("asset_kind", ["video", "image", "audio", "other"]);
export const assetStatusEnum = pgEnum("asset_status", ["ok", "corrupt", "unsupported", "missing"]);
export const renderStatusEnum = pgEnum("render_status", ["queued", "running", "done", "failed"]);
export const planAuthorEnum = pgEnum("plan_author", ["claude", "user", "system"]);

// ---------------------------------------------------------------- foydalanuvchi va qurilmalar

export const users = pgTable("users", {
  id: id(),
  /** Eski (email) hisoblar uchun; yangi hisoblar Telegram orqali (email yo'q). */
  email: text("email").unique(),
  /** Telegram foydalanuvchi id'si (kirish, P5 — Telegram login). */
  telegramId: text("telegram_id").unique(),
  /** Ko'rinadigan nom (Telegram ism / @username). */
  name: text("name"),
  createdAt: createdAt(),
});

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    os: text("os").notNull(),
    aeVersion: text("ae_version"),
    lastSeenAt: tstz("last_seen_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- OAuth (§4)

export const oauthClients = pgTable("oauth_clients", {
  /** `client_id`: DCR'da tasodifiy, CIMD'da metadata hujjati URL'i. */
  id: text("id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  /** `dcr` (RFC 7591) yoki `cimd` (Client ID Metadata Document). */
  kind: text("kind").notNull().default("dcr"),
  /** `none` (public) | `client_secret_post` | `client_secret_basic`. */
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  /** Confidential klient siri: faqat sha256. */
  secretHash: text("secret_hash"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: id(),
    /** device_code tasdiqlanmaguncha user yo'q. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    kind: tokenKindEnum("kind").notNull(),
    /** Faqat hash saqlanadi (sha256), token o'zi hech qachon. */
    hash: text("hash").notNull().unique(),
    scope: text("scope"),
    /** Turga xos: PKCE challenge, redirect_uri, user_code, holat ... */
    data: jsonb("data").$type<Record<string, unknown>>(),
    expiresAt: tstz("expires_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("oauth_tokens_user_idx").on(t.userId),
    index("oauth_tokens_device_idx").on(t.deviceId),
  ],
);

/** ElevenLabs kaliti va boshqa sirlar: AES-256-GCM (§4.4). */
export const secrets = pgTable(
  "secrets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

// ---------------------------------------------------------------- loyihalar, rejalar, assetlar

export const projects = pgTable(
  "projects",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

/** Spec versiyalari: hech biri ustiga yozilmaydi (§2.10). */
export const plans = pgTable(
  "plans",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: jsonb("spec").notNull(),
    createdBy: planAuthorEnum("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("plans_project_version_uq").on(t.projectId, t.version),
    check("plans_version_positive", sql`${t.version} >= 1`),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** `asset:<key>` dagi kalit. */
    key: text("key").notNull(),
    localPath: text("local_path").notNull(),
    kind: assetKindEnum("kind").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** Thumbnail'ning storage kaliti. */
    thumbUrl: text("thumb_url"),
    hash: text("hash").notNull(),
    status: assetStatusEnum("status").notNull().default("ok"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("assets_project_key_uq").on(t.projectId, t.key)],
);

// ---------------------------------------------------------------- batch (§11.4.3)

export const batches = pgTable(
  "batches",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    template: text("template").notNull(),
    /** format, variants, dur, brand. */
    options: jsonb("options").notNull(),
    /** Qatorlar: slotlar, holat, job, natija fayllari. */
    items: jsonb("items").notNull(),
    /** running | done | failed | cancelled */
    status: text("status").notNull().default("running"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("batches_project_idx").on(t.projectId)],
);

// ---------------------------------------------------------------- joblar (§3)

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Job qaysi qurilmada bajariladi (loyihadan olinadi): bitta qurilmada bitta aktiv job. */
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    planVersion: integer("plan_version").notNull(),
    state: jobStateEnum("state").notNull().default("CHECK"),
    prevState: jobStateEnum("prev_state"),
    outcome: jobOutcomeEnum("outcome"),
    patchCount: integer("patch_count").notNull().default(0),
    /** Qurilayotgan `.aep` versiyasi (vNNN, P2.13); PREFLIGHT'da ajratiladi. */
    aepVersion: integer("aep_version"),
    /** Oplist barmoq izi: o'zgarmagan bo'lsa BUILD `done` oplarni saqlab davom etadi. */
    oplistHash: text("oplist_hash"),
    /** Live ekranidagi Pause (P2.12): BUILD oplar orasida to'xtaydi. */
    paused: boolean("paused").notNull().default(false),
    /** Claude'siz rejim (panel Shablonlar, batch): VERIFY avtomatik tasdiqlanadi. */
    autoApprove: boolean("auto_approve").notNull().default(false),
    /** Batch qatori bo'lsa (P5.07). */
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_project_idx").on(t.projectId),
    index("jobs_state_idx").on(t.state),
    check("jobs_patch_count_nonneg", sql`${t.patchCount} >= 0`),
    uniqueIndex("jobs_device_active_uq")
      .on(t.deviceId)
      .where(sql`${t.state} <> 'DONE'`),
    unique("jobs_project_aep_version_uq").on(t.projectId, t.aepVersion),
  ],
);

/** Live log manbai (§2.1). */
export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    ts: tstz("ts").notNull().defaultNow(),
    level: logLevelEnum("level").notNull(),
    type: text("type").notNull(),
    opId: text("op_id"),
    message: text("message").notNull(),
    data: jsonb("data"),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.id)],
);

export const ops = pgTable(
  "ops",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** Idempotentlik kaliti (§2.5): AE'da layer/item comment'ida iz qoladi. */
    opId: text("op_id").notNull(),
    op: text("op").notNull(),
    params: jsonb("params").notNull(),
    status: opStatusEnum("status").notNull().default("pending"),
    result: jsonb("result"),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
    error: jsonb("error"),
  },
  (t) => [
    unique("ops_job_op_id_uq").on(t.jobId, t.opId),
    index("ops_job_seq_idx").on(t.jobId, t.seq),
  ],
);

// ---------------------------------------------------------------- audio (§7)

export const audioTasks = pgTable(
  "audio_tasks",
  {
    id: id(),
    /** Job ichidagi vazifa (AUDIO holati); MCP'dan to'g'ridan-to'g'ri chaqirilganda null. */
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Natija shu loyiha papkasining `audio/` iga yuklab olinadi. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Odamga tushunarli nom (Audio ekrani, hisobot). */
    label: text("label"),
    params: jsonb("params").notNull(),
    /** Kirish fayllari (storage `audio-in`): `{ name, storage_key, sha256 }[]`. */
    inputs: jsonb("inputs").$type<{ name: string; storage_key: string; sha256: string }[]>(),
    paramsHash: text("params_hash").notNull(),
    status: taskStatusEnum("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    ext: text("ext"),
    sha256: text("sha256"),
    localPath: text("local_path"),
    deliveredAt: tstz("delivered_at"),
    durationMs: integer("duration_ms"),
    credits: integer("credits"),
    /** Keshdan olindi (kredit sarflanmadi). */
    cached: boolean("cached").notNull().default(false),
    /** Imkoniyatga xos natija: alignment, transcript, previews, voice_id ... */
    result: jsonb("result"),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("audio_tasks_job_idx").on(t.jobId),
    index("audio_tasks_hash_idx").on(t.paramsHash),
    index("audio_tasks_project_idx").on(t.projectId),
  ],
);

/** Bir xil `params_hash` qayta generatsiya qilinmaydi (§7.1). */
export const elevenCache = pgTable("eleven_cache", {
  paramsHash: text("params_hash").primaryKey(),
  kind: text("kind").notNull(),
  /** Audio natija (STT/alignment kabi faqat JSON natijalarda null). */
  storageKey: text("storage_key"),
  contentType: text("content_type"),
  ext: text("ext"),
  sha256: text("sha256"),
  durationMs: integer("duration_ms"),
  credits: integer("credits"),
  result: jsonb("result"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- shablonlar va brand (§11)

export const templates = pgTable(
  "templates",
  {
    id: id(),
    /** null — umumiy (tizim) shablon. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    manifest: jsonb("manifest").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique("templates_owner_slug_version_uq").on(t.userId, t.slug, t.version).nullsNotDistinct(),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("brands_user_slug_uq").on(t.userId, t.slug)],
);

// ---------------------------------------------------------------- render va hisobot

export const renders = pgTable(
  "renders",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    preset: text("preset").notNull(),
    /** Format varianti tegi (`16x9`); null — asosiy format (§11.4.1). */
    variant: text("variant"),
    /** Qaysi `.aep` versiyasi render qilingan (patch'dan keyin eski renderlar hisobga olinmaydi). */
    aepVersion: integer("aep_version"),
    /** Ish papkasiga nisbiy (`out/<nom>_vNNN.mp4`); render tugaguncha — rejalashtirilgan asos. */
    localPath: text("local_path").notNull(),
    durationMs: integer("duration_ms"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** `aerender` | `render_queue` (Q5). */
    method: text("method"),
    encoder: text("encoder"),
    status: renderStatusEnum("status").notNull().default("queued"),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("renders_job_idx").on(t.jobId)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("reports_job_idx").on(t.jobId)],
);

// ---------------------------------------------------------------- audit (P3.10)

/** Xavfsizlikka oid hodisalar: ruxsatlar, tokenlar, qurilmalar, Claude'ning o'zgartiruvchi chaqiruvlari. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    ts: tstz("ts").notNull().defaultNow(),
    /** `user` (kabinet) | `claude` (MCP) | `device` (panel) | `system`. */
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    ip: text("ip"),
    data: jsonb("data"),
  },
  (t) => [index("audit_log_user_idx").on(t.userId, t.id)],
);

// ---------------------------------------------------------------- talaffuz lug'atlari (P4.05)

/** ElevenLabs pronunciation dictionary'lari: spec'da slug bilan (`voiceover.pronunciation`). */
export const pronunciationDicts = pgTable(
  "pronunciation_dicts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    elId: text("el_id").notNull(),
    versionId: text("version_id").notNull(),
    rules: jsonb("rules").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("pronunciation_dicts_user_slug_uq").on(t.userId, t.slug)],
);

// ---------------------------------------------------------------- Telegram (P5.08)

export const telegramLinks = pgTable("telegram_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Bog'langan chat (null — hali bog'lanmagan, faqat kod bor). */
  chatId: text("chat_id"),
  chatTitle: text("chat_title"),
  /** Bir martalik bog'lash kodi va muddati. */
  code: text("code").unique(),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  linkedAt: timestamp("linked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Telegram orqali kirish so'rovlari: brauzer (cookie siri) ↔ bot deep link kodi (bir martalik, 10 daqiqa). */
export const telegramLogins = pgTable("telegram_logins", {
  id: id(),
  /** Deep link'dagi kod (`/start login_<kod>`). */
  code: text("code").notNull().unique(),
  /** Brauzer cookie sirining sha256 hash'i (kodni boshqa brauzer ishlata olmaydi). */
  browserHash: text("browser_hash").notNull().unique(),
  /** Kirgandan keyin qaytiladigan ichki yo'l. */
  next: text("next").notNull().default("/"),
  /** Bot tasdiqlagan foydalanuvchi. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
