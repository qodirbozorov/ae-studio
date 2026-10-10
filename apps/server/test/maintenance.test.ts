/**
 * P5.13: production xizmat ko'rsatish — DB backup (storage, rotatsiya) va toza bazaga tiklash (turlar bilan),
 * loglarni saqlash muddati (faqat yakunlangan va eski joblar), sozlamalar.
 */
import { gunzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { auditLog, devices, jobEvents, jobs, projects, secrets, users } from "../src/db/schema";
import { orderedTables, restoreDatabase } from "../src/ops/backup";
import { BACKUP_PREFIX } from "../src/ops/maintenance";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { createTestDb } from "./helpers/db";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";
import { getTableName } from "drizzle-orm";

const ROOT = "D:/Projects/ops";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
  {
    key: "photo_02",
    local_path: "source/photo_02.jpg",
    kind: "image",
    meta: { width: 1000, height: 1500 },
  },
  { key: "ding", local_path: "audio/ding.wav", kind: "audio", meta: { duration: 1 } },
];

let t: TestApp;
let jobId: string;

beforeEach(async () => {
  t = await createTestApp({ BACKUP_KEEP: "2", LOG_RETENTION_DAYS: "30" });
  const cookie = await login(t, "ops@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "ops@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: ROOT })
    .returning();
  const agent = new FakeAgent(
    t.app.hub,
    { userId: user!.id, deviceId: device!.id },
    { root: ROOT, assets: ASSETS },
  );
  agent.connect();
  const s = await mcpSession(t, "ops@x.uz");
  await s.call("plan_write", { project_id: project!.id, spec: THREE_SCENES });
  jobId = (await s.call("build_start", { project_id: project!.id })).result.data.id;
  await t.app.jobs.idle();
  await s.call("verify_approve", { job_id: jobId, render: true, user_confirmed: true });
  await t.app.jobs.idle();
  await t.app.jobs.idle();
  await t.app.inject({
    method: "PUT",
    url: "/api/brands",
    headers: { cookie },
    payload: {
      slug: "default",
      name: "B",
      colors: { primary: "#112233" },
      fonts: { heading: { family: "A" }, body: { family: "B" } },
    },
  });
});

afterEach(async () => {
  await t.close();
});

describe("backup", () => {
  it("jadvallar FK tartibida (ota avval)", () => {
    const names = orderedTables().map(getTableName);
    for (const [child, parent] of [
      ["devices", "users"],
      ["jobs", "projects"],
      ["jobs", "batches"],
      ["job_events", "jobs"],
      ["renders", "jobs"],
    ]) {
      expect(names.indexOf(parent!), `${parent} < ${child}`).toBeLessThan(names.indexOf(child!));
    }
  });

  it("storage'ga backup, rotatsiya (BACKUP_KEEP=2), toza bazaga to'liq tiklash", async () => {
    const first = await t.app.maintenance.backup();
    expect(first.key.startsWith(BACKUP_PREFIX)).toBe(true);
    expect(first.stats.rows).toBeGreaterThan(20);
    t.clock.advance(1000);
    await t.app.maintenance.backup();
    t.clock.advance(1000);
    const third = await t.app.maintenance.backup();
    expect(third.pruned).toEqual([first.key]);
    expect(await t.app.storage.list(BACKUP_PREFIX)).toHaveLength(2);

    const data = (await t.app.storage.getBytes(third.key))!;
    expect(gunzipSync(data).toString("utf8")).toContain('"table":"jobs"');

    const fresh = await createTestDb();
    const stats = await restoreDatabase(fresh.db, data);
    expect(stats.rows).toBe(third.stats.rows);
    const [orig] = await t.db.db.select().from(jobs).where(eq(jobs.id, jobId));
    const [copy] = await fresh.db.select().from(jobs).where(eq(jobs.id, jobId));
    // Turlar aniq: timestamptz → Date, jsonb, boolean.
    expect(copy).toEqual(orig);
    expect(copy!.createdAt).toBeInstanceOf(Date);
    expect((await fresh.db.select().from(jobEvents)).length).toBe(
      (await t.db.db.select().from(jobEvents)).length,
    );
    expect((await fresh.db.select().from(secrets)).length).toBe(
      (await t.db.db.select().from(secrets)).length,
    );
    // Bo'sh bo'lmagan bazaga tiklanmaydi (ustiga yozilmaydi).
    await expect(restoreDatabase(fresh.db, data)).rejects.toThrow(/bo'sh emas/);
    await fresh.close();
  });
});

describe("loglarni saqlash muddati", () => {
  it("yakunlangan va eski job'ning eventlari o'chadi; yangilari va audit qoladi", async () => {
    const before = (await t.db.db.select().from(jobEvents)).length;
    expect(before).toBeGreaterThan(0);
    // Hali muddati kelmagan.
    expect((await t.app.maintenance.cleanup()).job_events).toBe(0);
    t.clock.advance(31 * 24 * 3600_000);
    const stats = await t.app.maintenance.cleanup();
    expect(stats.job_events).toBe(before);
    expect(await t.db.db.select().from(jobEvents)).toHaveLength(0);
    expect((await t.db.db.select().from(auditLog)).length).toBeGreaterThan(0);
    // Job o'zi va hisoboti qoladi.
    expect(await t.db.db.select().from(jobs)).toHaveLength(1);
  });
});
