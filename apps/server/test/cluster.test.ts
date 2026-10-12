/**
 * P9.07: ikki replika (bitta DB, umumiy cluster tarmog'i). Panel B'ga ulangan, Claude (MCP) A'ga keladi:
 * presence, RPC orqali op'lar, job oxirigacha, kick va qayta ulanish, job qulfi, umumiy rate limit,
 * audio kutuvchilari va sozlamalar tarqatilishi.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { MemoryCluster, MemoryNetwork, withLock } from "../src/cluster";
import { audioTasks, devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { createTestDb } from "./helpers/db";
import type { TestDb } from "./helpers/db";
import { FakeAgent } from "./helpers/fake-agent";
import type { ScannedAsset } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

const ROOT = "D:/Projects/cluster";
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
const ADMIN = { ADMIN_LOGIN: "boss", ADMIN_PASSWORD: "juda-uzun-parol-123" };

let db: TestDb;
let network: MemoryNetwork;
let a: TestApp;
let b: TestApp;
let userId: string;
let deviceId: string;
let projectId: string;

/** Cluster xabarlari asinxron (setImmediate) — bir necha aylanish kutamiz. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function replica(): Promise<TestApp> {
  return createTestApp(ADMIN, db, {
    cluster: () => new MemoryCluster({ network }),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  network = new MemoryNetwork();
  a = await replica();
  b = await replica();
  await login(a, "c@x.uz");
  const [user] = await db.db.select().from(users).where(eq(users.email, "c@x.uz"));
  userId = user!.id;
  const [device] = await db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  deviceId = device!.id;
  const [project] = await db.db
    .insert(projects)
    .values({ userId, deviceId, name: "reel", rootPath: ROOT })
    .returning();
  projectId = project!.id;
});

afterEach(async () => {
  await a.close();
  await b.close();
  await db.close();
});

function panelOn(app: TestApp): FakeAgent {
  const agent = new FakeAgent(app.app.hub, { userId, deviceId }, { root: ROOT, assets: ASSETS });
  agent.storage = app.app.storage;
  agent.connect();
  return agent;
}

describe("ikki replika", () => {
  it("presence: B'dagi panel A'da onlayn, holati ko'rinadi; uzilsa offline", async () => {
    const agent = panelOn(b);
    await settle();
    expect(a.app.hub.isOnline(deviceId)).toBe(true);
    expect(a.app.hub.state(deviceId)).toMatchObject({ projectRoot: ROOT, aeVersion: "22.0" });
    agent.disconnect();
    await settle();
    expect(a.app.hub.isOnline(deviceId)).toBe(false);
  });

  it("yangi replika ishga tushganda mavjud panellar ro'yxatini oladi", async () => {
    panelOn(b);
    await settle();
    const c = await replica();
    try {
      await c.app.ready();
      await settle();
      expect(c.app.hub.isOnline(deviceId)).toBe(true);
    } finally {
      await c.close();
    }
  });

  it("Claude A'da, panel B'da: job oxirigacha (op'lar RPC orqali), MCP holatlari to'g'ri", async () => {
    panelOn(b);
    await settle();
    const s = await mcpSession(a, "c@x.uz");
    const env = await s.call("env_check");
    expect(env.result.ok, JSON.stringify(env.result)).toBe(true);
    await s.call("plan_write", { project_id: projectId, spec: THREE_SCENES });
    const started = await s.call("build_start", { project_id: projectId });
    expect(started.result.ok, JSON.stringify(started.result.error)).toBe(true);
    const id = started.result.data.id as string;
    for (let i = 0; i < 200; i++) {
      await a.app.jobs.idle();
      await b.app.jobs.idle();
      const job = await a.app.jobs.get(id);
      if (job !== null && ["VERIFY", "BLOCKED", "DONE"].includes(job.state)) break;
      await settle();
    }
    const status = (await s.call("job_status", { job_id: id })).result.data;
    expect(status.state, JSON.stringify(status.error)).toBe("VERIFY");
  });

  it("send va kick boshqa replikadagi panelga yetadi; boshqa replikaga qayta ulanish eskisini yopadi", async () => {
    const agent = panelOn(b);
    await settle();
    expect(a.app.hub.send(deviceId, { type: "ping", ts: 1 })).toBe(true);

    const second = panelOn(a);
    await settle();
    expect(agent.connected).toBe(false);
    expect(second.connected).toBe(true);
    expect(b.app.hub.isOnline(deviceId)).toBe(true);
    expect(a.app.hub.isOnline(deviceId)).toBe(true);

    b.app.hub.kick(deviceId, "test");
    await settle();
    expect(second.connected).toBe(false);
    expect(a.app.hub.isOnline(deviceId)).toBe(false);
    expect(b.app.hub.isOnline(deviceId)).toBe(false);
  });

  it("RPC: panel javobsiz uzilsa — kutayotgan op ENV_AGENT_OFFLINE bilan tugaydi", async () => {
    const agent = panelOn(b);
    agent.onOp = () => "drop";
    await settle();
    const pending = a.app.hub.run(
      deviceId,
      { op_id: "x1", op: "ae.ping", args: {}, timeout_ms: 60_000 } as never,
      "direct",
    );
    await settle();
    agent.disconnect();
    await settle();
    expect(await pending).toMatchObject({ ok: false, error: { code: "ENV_AGENT_OFFLINE" } });
  });

  it("job qulfi: A ushlab tursa B yuritmaydi, A'ga 'yana yurit' yuboradi", async () => {
    const jobId = "00000000-0000-4000-8000-000000000001";
    const drive = vi.spyOn(a.app.jobs, "drive");
    const held = await (a.app.cluster as MemoryCluster).acquire(`job:${jobId}`, 60_000);
    expect(held).toBe(true);
    await b.app.jobs.drive(jobId);
    await settle();
    expect(drive).toHaveBeenCalledWith(jobId);
    await a.app.cluster.release(`job:${jobId}`);
  });

  it("withLock: bir vaqtda faqat bittasi bajaradi", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = withLock(a.app.cluster, "k", 10_000, async () => {
      order.push("a");
      await gate;
    });
    await settle();
    const second = await withLock(b.app.cluster, "k", 10_000, async () => order.push("b"));
    expect(second).toEqual({ done: false });
    release();
    await first;
    expect((await withLock(b.app.cluster, "k", 10_000, async () => order.push("b"))).done).toBe(
      true,
    );
    expect(order).toEqual(["a", "b"]);
  });

  it("admin login rate limit replikalar uchun umumiy", async () => {
    for (let i = 0; i < 8; i++) {
      const app = i % 2 === 0 ? a : b;
      const res = await app.app.inject({
        method: "POST",
        url: "/api/admin/login",
        payload: { login: "boss", password: "xato" },
      });
      expect(res.statusCode).toBe(401);
    }
    const blocked = await b.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "boss", password: "juda-uzun-parol-123" },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it("audio: vazifani boshqa replika tugatsa ham kutuvchi javob oladi", async () => {
    const [task] = await db.db
      .insert(audioTasks)
      .values({
        userId,
        projectId,
        kind: "tts",
        label: "VO",
        params: { text: "x" },
        paramsHash: "h-cluster",
        status: "running",
      })
      .returning();
    const waiting = b.app.audio.wait(task!.id, 10_000);
    await db.db.update(audioTasks).set({ status: "done" }).where(eq(audioTasks.id, task!.id));
    await b.app.audio.syncWaiters();
    expect(await waiting).toMatchObject({ id: task!.id, status: "done" });
  });

  it("narx sozlamasi A'da saqlansa B darhol qo'llaydi", async () => {
    const login = await a.app.inject({
      method: "POST",
      url: "/api/admin/login",
      payload: { login: "boss", password: "juda-uzun-parol-123" },
    });
    const cookie = `aes_admin=${login.cookies.find((c) => c.name === "aes_admin")!.value}`;
    await a.app.inject({
      method: "PUT",
      url: "/api/admin/pricing",
      headers: { cookie },
      payload: { rates: { markup: 3 } },
    });
    await settle();
    expect(b.app.billing.rates.markup).toBe(3);
  });
});
