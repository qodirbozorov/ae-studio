/**
 * P4.12: panel Audio ekrani endpointlari (qurilma tokeni) va jonli `audio.update`.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueToken } from "../src/auth/tokens";
import { devices, projects, users } from "../src/db/schema";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { FakeAgent } from "./helpers/fake-agent";
import { FakeEleven, VALID_KEY } from "./helpers/fake-eleven";

let t: TestApp;
let el: FakeEleven;
let cookie: string;
let userId: string;
let projectId: string;
let token: string;
let agent: FakeAgent;

beforeEach(async () => {
  el = new FakeEleven();
  t = await createTestApp({}, undefined, {
    elevenOptions: { fetch: el.fetch, sleep: async () => {} },
  });
  cookie = await login(t, "as@x.uz");
  const [user] = await t.db.db.select().from(users).where(eq(users.email, "as@x.uz"));
  userId = user!.id;
  const [device] = await t.db.db
    .insert(devices)
    .values({ userId, name: "PC", os: "win" })
    .returning();
  const [project] = await t.db.db
    .insert(projects)
    .values({ userId, deviceId: device!.id, name: "reel", rootPath: "D:/r" })
    .returning();
  projectId = project!.id;
  token = (
    await issueToken(t.db.db, {
      kind: "device",
      ttlMs: null,
      now: t.clock.now,
      userId,
      deviceId: device!.id,
    })
  ).token;
  agent = new FakeAgent(t.app.hub, { userId, deviceId: device!.id }, { root: "D:/r" });
  agent.connect();
  await t.app.inject({
    method: "PUT",
    url: "/api/settings/elevenlabs",
    headers: { cookie },
    payload: { api_key: VALID_KEY },
  });
});

afterEach(async () => {
  await t.close();
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe("Audio ekrani", () => {
  it("ro'yxat, jonli yangilanish, qayta generatsiya (yangi variant), qayta urinish", async () => {
    const task = await t.app.audio.submit({
      userId,
      projectId,
      kind: "sfx",
      label: "Whoosh",
      params: { text: "whoosh", duration_seconds: 1 },
    });
    const done = await t.app.audio.wait(task.ok ? task.data.id : "", 5000);
    await t.app.audio.idle();
    expect(agent.ofType("audio.update").map((m) => m.task.status)).toEqual(
      expect.arrayContaining(["queued", "done"]),
    );

    const list = await t.app.inject({
      url: `/api/agent/audio?project_id=${projectId}`,
      headers: auth(),
    });
    expect(list.json().data).toEqual([
      expect.objectContaining({
        id: done!.id,
        label: "Whoosh",
        status: "done",
        local_path: expect.stringMatching(/^audio\/sfx_/),
      }),
    ]);

    const calls = el.generationCalls().length;
    const regen = await t.app.inject({
      method: "POST",
      url: `/api/agent/audio/${done!.id}/regenerate`,
      headers: auth(),
    });
    expect(regen.json().data).toMatchObject({ kind: "sfx", status: "queued", cached: false });
    await t.app.audio.wait(regen.json().data.id, 5000);
    expect(el.generationCalls()).toHaveLength(calls + 1);

    const retryDone = await t.app.inject({
      method: "POST",
      url: `/api/agent/audio/${done!.id}/retry`,
      headers: auth(),
    });
    expect(retryDone.statusCode).toBe(409);
  });

  it("boshqa qurilma begona audio'ni ko'rmaydi va boshqara olmaydi", async () => {
    const task = await t.app.audio.submit({
      userId,
      projectId,
      kind: "sfx",
      params: { text: "x" },
    });
    await t.app.audio.wait(task.ok ? task.data.id : "", 5000);
    const [other] = await t.db.db
      .insert(devices)
      .values({ userId, name: "B", os: "mac" })
      .returning();
    const otherToken = (
      await issueToken(t.db.db, {
        kind: "device",
        ttlMs: null,
        now: t.clock.now,
        userId,
        deviceId: other!.id,
      })
    ).token;
    const headers = { authorization: `Bearer ${otherToken}` };
    expect((await t.app.inject({ url: "/api/agent/audio", headers })).json().data).toEqual([]);
    const regen = await t.app.inject({
      method: "POST",
      url: `/api/agent/audio/${task.ok ? task.data.id : ""}/regenerate`,
      headers,
    });
    expect(regen.statusCode).toBe(404);
  });
});
