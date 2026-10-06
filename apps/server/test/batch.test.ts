/**
 * P5.07: batch — CSV parser, shablon + CSV (3 qator) → 3 ta video (ketma-ket, auto_approve),
 * oldindan tekshiruv, BLOCKED qator → failed va davom etish, bekor qilish, MCP toollari, REST.
 */
import { makeError } from "@aes/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords } from "../src/batch/csv";
import { devices, jobs, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";
import type { McpSession } from "./helpers/mcp";

describe("CSV", () => {
  it('qo\'shtirnoq, ichki vergul/qator, "" , CRLF, BOM, ; ajratuvchi', () => {
    expect(parseCsvRecords('\uFEFFa,b\r\n"x, y","say ""hi""\nok"\r\n\r\n3,4').ok).toBe(true);
    const r = parseCsvRecords('\uFEFFa,b\r\n"x, y","say ""hi""\nok"\r\n\r\n3,4');
    expect(r.ok && r.data).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nok'],
      ["3", "4"],
    ]);
    const semi = parseCsv("title;item1\nSalom; Bir \n");
    expect(semi.ok && semi.data).toEqual({
      header: ["title", "item1"],
      rows: [{ title: "Salom", item1: "Bir" }],
    });
  });

  it("xatolar: bo'sh, takror ustun, ortiqcha maydon, yopilmagan qo'shtirnoq", () => {
    expect(parseCsv("").ok).toBe(false);
    expect(parseCsv("a,a\n1,2").ok).toBe(false);
    expect(parseCsv("a,b\n1,2,3").ok).toBe(false);
    expect(parseCsv('a\n"open').ok).toBe(false);
    expect(parseCsv("a,b").ok).toBe(false);
  });
});

const ROOT = "D:/Projects/batch";
const ASSETS: ScannedAsset[] = [
  {
    key: "clip_01",
    local_path: "source/clip_01.mp4",
    kind: "video",
    meta: { width: 1920, height: 1080, duration: 8 },
  },
];

const CSV = [
  "name,title,item1,item2,item3",
  "Ovqat,3 ta retsept,Palov,Manti,Lag'mon",
  'Sport,"Ertalab, 3 mashq",Yugurish,Turnik,Plank',
  "Kitob,3 ta kitob,Alkimyogar,O'tkan kunlar,Sariq devni minib",
].join("\n");

let t: TestApp;
let s: McpSession;
let projectId: string;
let deviceId: string;
let agent: FakeAgent;

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "bt@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "bt@x.uz"));
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId: user!.id, name: "PC", os: "win" })
    .returning();
  deviceId = device!.id;
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId: user!.id, deviceId, name: "batch", rootPath: ROOT })
    .returning();
  projectId = project!.id;
  agent = new FakeAgent(t.app.hub, { userId: user!.id, deviceId }, { root: ROOT, assets: ASSETS });
  agent.connect();
  s = await mcpSession(t, "bt@x.uz");
});

afterEach(async () => {
  await t.close();
});

/** Joblar va batch zanjiri tinchlanguncha. */
async function settle(batchId: string) {
  for (let i = 0; i < 40; i++) {
    await t.app.jobs.idle();
    await t.app.batches.idle();
    const status = (await s.call("batch_status", { batch_id: batchId })).result.data;
    if (status.status !== "running") return status;
  }
  return (await s.call("batch_status", { batch_id: batchId })).result.data;
}

describe("batch", () => {
  it("shablon + CSV (3 qator) → 3 ta video, ketma-ket, VERIFY'siz; hisobot", async () => {
    const renders: string[] = [];
    agent.onRender = (m) => {
      renders.push(m.out_base);
      return "ok";
    };
    const started = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: CSV,
      format: "1:1",
      dur: 4,
    });
    expect(started.result.data).toMatchObject({ status: "running", total: 3 });
    const done = await settle(started.result.data.id);
    expect(done).toMatchObject({ status: "done", done: 3, failed: 0 });
    expect(done.items.map((i: { name: string }) => i.name)).toEqual(["Ovqat", "Sport", "Kitob"]);
    expect(renders).toEqual(["out/Ovqat_v001", "out/Sport_v002", "out/Kitob_v003"]);
    expect(done.items[1].outputs).toEqual(["out/Sport_v002.mp4"]);
    expect(done.report).toContain("| 2 | Sport | done | `out/Sport_v002.mp4` |");
    const rows = await t.db.db.select().from(jobs).where(eq(jobs.projectId, projectId));
    expect(rows.every((j) => j.autoApprove && j.batchId === started.result.data.id)).toBe(true);
    // Plan: sarlavhadagi vergul bilan qiymat to'g'ri slotga tushgan.
    const plan = await t.app.jobs.plan(
      projectId,
      rows.find((j) => j.planVersion === 2)!.planVersion,
    );
    expect(JSON.stringify(plan!.spec)).toContain("Ertalab, 3 mashq");
  });

  it("oldindan tekshiruv: noto'g'ri qatorlar — hech narsa boshlanmaydi", async () => {
    const res = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: `title,item1,item2,item3\nYaxshi,a,b,c\n${"x".repeat(41)},a,b,c\n,a,b,c`,
    });
    expect(res.result.error).toMatchObject({
      code: "SPEC_INVALID",
      details: { rows: [{ row: 2 }, { row: 3 }] },
    });
    expect(await t.db.db.select().from(jobs)).toHaveLength(0);
    const badMap = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: "a\n1",
      mapping: { a: "nope" },
    });
    expect(badMap.result.error.message).toMatch(/nope/);
  });

  it("BLOCKED qator → failed (job bekor) va keyingisi davom etadi", async () => {
    let n = 0;
    agent.onRender = () => (++n === 2 ? makeError("RENDER_FAILED", "disk to'la") : "ok");
    const started = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: CSV,
    });
    const done = await settle(started.result.data.id);
    expect(done).toMatchObject({ status: "done", done: 2, failed: 1 });
    expect(done.items[1]).toMatchObject({ status: "failed", error: { code: "RENDER_FAILED" } });
    expect(done.report).toContain("disk to'la");
  });

  it("batch_cancel: qolgan qatorlar to'xtaydi", async () => {
    agent.onRender = () => "drop";
    const started = await s.call("batch_start", {
      project_id: projectId,
      template: "top3_list",
      csv: CSV,
    });
    await t.app.batches.idle();
    const cancelled = await s.call("batch_cancel", { batch_id: started.result.data.id });
    expect(cancelled.result.data).toMatchObject({ status: "cancelled" });
    await t.app.jobs.idle();
    const after = (await s.call("batch_status", { batch_id: started.result.data.id })).result.data;
    expect(after.items.filter((i: { status: string }) => i.status === "failed")).toHaveLength(2);
  });

  it("REST (panel): boshqa qurilma loyihasi rad etiladi, holat ko'rinadi", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/api/agent/batches",
      headers: { authorization: "Bearer yoq" },
      payload: { project_id: projectId, template: "top3_list", csv: CSV },
    });
    expect(res.statusCode).toBe(401);
  });
});
