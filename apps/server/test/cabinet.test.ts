/** P5.09: web kabinet — job tarixi (barcha loyihalar), hisobot, batch'lar, brand kit'lar; boshqa user ko'rmaydi. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/cab";
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
let cookie: string;
let other: string;

beforeEach(async () => {
  t = await createTestApp();
  cookie = await login(t, "cab@x.uz");
  other = await login(t, "boshqa@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "cab@x.uz"));
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
  const s = await mcpSession(t, "cab@x.uz");
  await s.call("plan_write", { project_id: project!.id, spec: THREE_SCENES });
  const id = (await s.call("build_start", { project_id: project!.id })).result.data.id;
  await t.app.jobs.idle();
  await s.call("verify_approve", { job_id: id });
  await t.app.jobs.idle();
  await t.app.jobs.idle();
});

afterEach(async () => {
  await t.close();
});

const get = (url: string, c = cookie) =>
  t.app.inject({ method: "GET", url, headers: { cookie: c } });

describe("web kabinet", () => {
  it("job tarixi: loyiha nomi, renderlar, hisobot; boshqa user — bo'sh", async () => {
    const res = await get("/api/jobs");
    const list = res.json().data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      project_name: "reel",
      state: "DONE",
      outcome: "success",
      batch_id: null,
      renders: [{ status: "done", variant: null, local_path: "out/reel_v1_v001.mp4" }],
    });
    const report = await get(`/api/jobs/${list[0].id}/report`);
    expect(report.json().data.markdown).toContain("out/reel_v1_v001.mp4");
    expect((await get("/api/jobs", other)).json().data).toEqual([]);
    expect((await get(`/api/jobs/${list[0].id}/report`, other)).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: "/api/jobs" })).statusCode).toBe(401);
    expect((await get("/api/batches")).json().data).toEqual([]);
  });

  it("brand kit: saqlash, ro'yxat, xato, o'chirish", async () => {
    const brand = {
      slug: "default",
      name: "Mening brendim",
      colors: { primary: "#1E40AF" },
      fonts: { heading: { family: "Montserrat-Bold" }, body: { family: "Inter-Regular" } },
    };
    const saved = await t.app.inject({
      method: "PUT",
      url: "/api/brands",
      headers: { cookie },
      payload: brand,
    });
    expect(saved.json()).toMatchObject({
      ok: true,
      data: { slug: "default", colors: { text: "#FFFFFF" } },
    });
    expect((await get("/api/brands")).json().data).toHaveLength(1);
    expect((await get("/api/brands", other)).json().data).toEqual([]);
    const bad = await t.app.inject({
      method: "PUT",
      url: "/api/brands",
      headers: { cookie },
      payload: { ...brand, colors: { primary: "blue" } },
    });
    expect(bad.statusCode).toBe(400);
    const removed = await t.app.inject({
      method: "DELETE",
      url: "/api/brands/default",
      headers: { cookie },
    });
    expect(removed.json().data.removed).toBe(true);
    expect((await get("/api/brands")).json().data).toEqual([]);
  });
});
