/**
 * Postgres sxemasi — ae-studio-plan.md §5 (17 jadval).
 * Yagona haqiqat manbai `jobs` + `job_events` (§2.1). Holat enum'lari `@aes/shared` dan olinadi.
 */
import { JOB_OUTCOMES, JOB_STATES, LOG_LEVELS } from "@aes/shared";
import { sql } from "drizzle-orm";
import {
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
  email: text("email").notNull().unique(),
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
  /** `client_id` (dynamic client registration). */
  id: text("id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: createdAt(),
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
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    params: jsonb("params").notNull(),
    paramsHash: text("params_hash").notNull(),
    status: taskStatusEnum("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    localPath: text("local_path"),
    durationMs: integer("duration_ms"),
    credits: integer("credits"),
    error: jsonb("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audio_tasks_job_idx").on(t.jobId), index("audio_tasks_hash_idx").on(t.paramsHash)],
);

/** Bir xil `params_hash` qayta generatsiya qilinmaydi (§7.1). */
export const elevenCache = pgTable("eleven_cache", {
  paramsHash: text("params_hash").primaryKey(),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  durationMs: integer("duration_ms"),
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
    localPath: text("local_path").notNull(),
    durationMs: integer("duration_ms"),
    status: renderStatusEnum("status").notNull().default("queued"),
    createdAt: createdAt(),
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
