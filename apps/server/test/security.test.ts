/**
 * P3.10: xavfsizlik — audit jurnali, login/qurilma rate limit, server tomonida yo'l tekshiruvi, MCP audit.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THREE_SCENES } from "../../../packages/compiler/test/fixtures";
import { assets, auditLog, devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { mcpSession } from "./helpers/mcp";

let t: TestApp;
let cookie: string;
let userId: string;

beforeEach(async () => {
  t = await createTestApp();
  cookie = await login(t, "sec@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "sec@x.uz"));
  userId = user!.id;
});

afterEach(async () => {
  await t.close();
});

async function actions(): Promise<string[]> {
  const res = await t.app.inject({ url: "/api/audit", headers: { cookie } });
  return res.json().data.map((row: { action: string }) => row.action);
}

describe("audit jurnali", () => {
  it("qurilma tasdiqlash va bekor qilish yoziladi; begona yozuvlar ko'rinmaydi", async () => {
    const code = (
      await t.app.inject({
        method: "POST",
        url: "/oauth/device/code",
        payload: { device_name: "Studio", os: "win" },
      })
    ).json();
    await t.app.inject({
      method: "POST",
      url: "/api/devices/confirm",
      headers: { cookie },
      payload: { user_code: code.user_code, approve: true },
    });
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId, name: "PC2", os: "mac" })
      .returning();
    await t.app.inject({
      method: "POST",
      url: `/api/devices/${device!.id}/revoke`,
      headers: { cookie },
    });
    expect(await actions()).toEqual(["device.revoked", "device.approved"]);
    const rows = await t.db.db.select().from(auditLog);
    expect(rows[0]).toMatchObject({ actor: "user", ip: "127.0.0.1", target: "Studio" });

    const other = await login(t, "boshqa@x.uz");
    const foreign = await t.app.inject({ url: "/api/audit", headers: { cookie: other } });
    expect(foreign.json().data).toEqual([]);
    expect((await t.app.inject({ url: "/api/audit" })).statusCode).toBe(401);
  });

  it("MCP: faqat o'zgartiruvchi toollar yoziladi (actor=claude)", async () => {
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
      .returning();
    const s = await mcpSession(t, "sec@x.uz");
    await s.call("project_list");
    await s.call("plan_write", { project_id: project!.id, spec: THREE_SCENES });
    await new Promise((r) => setTimeout(r, 20));
    const rows = await t.db.db.select().from(auditLog).where(eq(auditLog.actor, "claude"));
    expect(rows.map((row) => row.action)).toEqual(["mcp.plan_write"]);
    expect(rows[0]!.data).toEqual({ ok: true });
  });
});

describe("rate limit", () => {
  it("qurilma kodi so'rovlari IP bo'yicha cheklanadi (429 + Retry-After)", async () => {
    let last = 0;
    let retry: string | undefined;
    for (let i = 0; i < 31; i++) {
      const res = await t.app.inject({
        method: "POST",
        url: "/oauth/device/code",
        payload: { device_name: "x", os: "y" },
      });
      last = res.statusCode;
      retry = res.headers["retry-after"] as string | undefined;
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    t.clock.advance(10 * 60_000 + 1000);
    const after = await t.app.inject({
      method: "POST",
      url: "/oauth/device/code",
      payload: { device_name: "x", os: "y" },
    });
    expect(after.statusCode).toBe(200);
  });
});

describe("server tomonida yo'l tekshiruvi", () => {
  it("asset_preview: ish papkasidan tashqaridagi yo'l panelga yuborilmaydi", async () => {
    const [device] = await t.db.db
      .insert(devices)
      .values({ userId, name: "PC", os: "win" })
      .returning();
    const [project] = await t.db.db
      .insert(projects)
      .values({ userId, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
      .returning();
    await t.db.db.insert(assets).values({
      projectId: project!.id,
      key: "evil",
      localPath: "../../secret.jpg",
      kind: "image",
      hash: "h",
      status: "ok",
    });
    const agent = new FakeAgent(t.app.hub, { userId, deviceId: device!.id }, { root: "D:/r" });
    agent.storage = t.app.storage;
    agent.connect();
    await new Promise((r) => setTimeout(r, 20));
    const s = await mcpSession(t, "sec@x.uz");
    const res = await s.call("asset_preview", { project_id: project!.id, key: "evil" });
    expect(res.result.error.code).toBe("ASSET_OUTSIDE_ROOT");
    expect(agent.previews).toEqual([]);
  });
});
