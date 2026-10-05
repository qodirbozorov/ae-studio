import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assets,
  devices,
  jobEvents,
  jobs,
  ops,
  plans,
  projects,
  secrets,
  templates,
  users,
} from "../src/db/schema";
import { createTestDb, expectPgError } from "./helpers/db";
import type { TestDb } from "./helpers/db";

const plan = readFileSync(new URL("../../../ae-studio-plan.md", import.meta.url), "utf8");

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
});

afterAll(async () => {
  await t.close();
});

async function seedProject(email = "a@example.com") {
  const [user] = await t.db.insert(users).values({ email }).returning();
  const [device] = await t.db
    .insert(devices)
    .values({ userId: user!.id, name: "Studio-PC", os: "Windows 10", aeVersion: "25.2" })
    .returning();
  const [project] = await t.db
    .insert(projects)
    .values({ userId: user!.id, deviceId: device!.id, name: "reel", rootPath: "D:/reel" })
    .returning();
  return { user: user!, device: device!, project: project! };
}

describe("migratsiyalar", () => {
  it("§5 dagi barcha 17 jadval (+ keyingi fazalar qo'shimchalari) yaratiladi", async () => {
    const block = plan.split("## 5. Ma'lumotlar modeli (Postgres)")[1]!.split("```sql")[1]!;
    const fromPlan = [...block.split("```")[0]!.matchAll(/^([a-z_]+)\s+\(/gm)].map((m) => m[1]!);
    expect(fromPlan).toHaveLength(17);

    const { rows } = await t.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    // §5 ga qo'shimcha: audit_log (P3.10, qarorlar jurnalida).
    const extra = ["audit_log"];
    expect(rows.map((r) => r.table_name).sort()).toEqual([...fromPlan, ...extra].sort());
  });

  it("qayta qo'llash xavfsiz (idempotent)", async () => {
    await expect(t.migrate()).resolves.toBeUndefined();
  });
});

describe("default qiymatlar va versiyalash", () => {
  it("job CHECK holatida, patch_count 0, updated_at yangilanadi", async () => {
    const { project } = await seedProject("jobs@example.com");
    const [job] = await t.db
      .insert(jobs)
      .values({ projectId: project.id, planVersion: 1 })
      .returning();
    expect(job!.state).toBe("CHECK");
    expect(job!.patchCount).toBe(0);
    expect(job!.outcome).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 15));
    const [updated] = await t.db
      .update(jobs)
      .set({ state: "PLAN", prevState: "CHECK" })
      .where(eq(jobs.id, job!.id))
      .returning();
    expect(updated!.state).toBe("PLAN");
    expect(updated!.updatedAt.getTime()).toBeGreaterThan(job!.updatedAt.getTime());
  });

  it("plan versiyasi takrorlanmaydi va 1 dan boshlanadi (§2.10)", async () => {
    const { project } = await seedProject("plans@example.com");
    const spec = { version: 1, scenes: [] };
    await t.db
      .insert(plans)
      .values({ projectId: project.id, version: 1, spec, createdBy: "claude" });
    await t.db.insert(plans).values({ projectId: project.id, version: 2, spec, createdBy: "user" });
    expect(
      await expectPgError(
        t.db.insert(plans).values({ projectId: project.id, version: 2, spec, createdBy: "claude" }),
      ),
    ).toBe("23505");
    expect(
      await expectPgError(
        t.db.insert(plans).values({ projectId: project.id, version: 0, spec, createdBy: "claude" }),
      ),
    ).toBe("23514");
  });

  it("asset kaliti loyiha ichida yagona, meta default {}", async () => {
    const { project } = await seedProject("assets@example.com");
    const row = {
      projectId: project.id,
      key: "clip_01",
      localPath: "source/clip_01.mp4",
      kind: "video" as const,
      hash: "h1",
    };
    const [asset] = await t.db.insert(assets).values(row).returning();
    expect(asset!.meta).toEqual({});
    expect(asset!.status).toBe("ok");
    expect(await expectPgError(t.db.insert(assets).values(row))).toBe("23505");
  });
});

describe("oplar va job_events", () => {
  it("op_id job ichida yagona (idempotentlik, §2.5), eventlar tartib bilan", async () => {
    const { project } = await seedProject("ops@example.com");
    const [job] = await t.db
      .insert(jobs)
      .values({ projectId: project.id, planVersion: 1 })
      .returning();
    const op = {
      jobId: job!.id,
      seq: 0,
      opId: "main.comp",
      op: "comp.create",
      params: { w: 1080 },
    };
    await t.db.insert(ops).values(op);
    expect(await expectPgError(t.db.insert(ops).values({ ...op, seq: 1 }))).toBe("23505");

    for (const message of ["⏳ comp.create", "✅ comp.create", "❌ layer.add_text"]) {
      await t.db.insert(jobEvents).values({ jobId: job!.id, level: "info", type: "op", message });
    }
    const events = await t.db
      .select()
      .from(jobEvents)
      .where(eq(jobEvents.jobId, job!.id))
      .orderBy(jobEvents.id);
    expect(events.map((e) => e.message)).toEqual([
      "⏳ comp.create",
      "✅ comp.create",
      "❌ layer.add_text",
    ]);
  });
});

describe("bog'lanishlar va o'chirish", () => {
  it("user o'chirilsa — qurilma, loyiha, job, sirlar ham o'chadi (cascade)", async () => {
    const { user, project } = await seedProject("cascade@example.com");
    await t.db.insert(jobs).values({ projectId: project.id, planVersion: 1 });
    await t.db
      .insert(secrets)
      .values({ userId: user.id, provider: "elevenlabs", ciphertext: "c", iv: "i", tag: "t" });

    await t.db.delete(users).where(eq(users.id, user.id));
    expect(await t.db.select().from(projects).where(eq(projects.id, project.id))).toEqual([]);
    expect(await t.db.select().from(jobs).where(eq(jobs.projectId, project.id))).toEqual([]);
    expect(await t.db.select().from(secrets).where(eq(secrets.userId, user.id))).toEqual([]);
  });

  it("qurilma o'chirilsa loyiha qoladi (device_id → null)", async () => {
    const { device, project } = await seedProject("setnull@example.com");
    await t.db.delete(devices).where(eq(devices.id, device.id));
    const [kept] = await t.db.select().from(projects).where(eq(projects.id, project.id));
    expect(kept!.deviceId).toBeNull();
  });

  it("noma'lum loyihaga job yozib bo'lmaydi (FK)", async () => {
    const orphan = t.db
      .insert(jobs)
      .values({ projectId: "00000000-0000-4000-8000-000000000000", planVersion: 1 });
    expect(await expectPgError(orphan)).toBe("23503");
  });

  it("umumiy shablon (user_id null) slug+versiya bo'yicha yagona (NULLS NOT DISTINCT)", async () => {
    const row = { slug: "hook_title", manifest: { slug: "hook_title" }, version: 1 };
    await t.db.insert(templates).values(row);
    expect(await expectPgError(t.db.insert(templates).values(row))).toBe("23505");
    await t.db.insert(templates).values({ ...row, version: 2 });
  });
});
