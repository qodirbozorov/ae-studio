/**
 * Uchidan-uchigacha (P2.05): device flow bilan juftlangan panel agenti ↔ server `/ws/agent` (device token)
 * ↔ jsx bundle (mock AE). Kabinetdan op → AE → natija; revoke; heartbeat; server qayta ishga tushishi.
 */
import { makeOp } from "@aes/shared";
import { existsSync, mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, login } from "../../server/test/helpers/app";
import type { TestApp } from "../../server/test/helpers/app";
import { credentialsPath } from "../src/agent/credentials";
import { createAgent } from "../src/agent/index";
import type { Agent, ConnectionStatus } from "../src/agent/index";
import { loadJsx } from "./jsx-harness";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

async function start(port = 0, db?: TestApp["db"]) {
  const app = await createTestApp({}, db);
  await app.app.listen({ port, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.app.server.address() as AddressInfo).port}`;
  return { app, base };
}

function waitFor(a: Agent, status: ConnectionStatus, timeoutMs = 8_000): Promise<void> {
  const client = a.connection();
  if (client === null) return Promise.reject(new Error("ulanish yo'q"));
  if (client.status() === status) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`holat kutildi: ${status}, hozir: ${client.status()}`)),
      timeoutMs,
    );
    const off = client.onStatus((next) => {
      if (next === status) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Haqiqiy device flow: kod → kabinetda tasdiq → token → WS. */
async function pairedAgent(
  app: TestApp,
  base: string,
  dataDir = mkdtempSync(join(tmpdir(), "aes-e2e-")),
) {
  const h = await loadJsx();
  const cookie = await login(app, `owner-${Date.now()}@x.uz`);
  const a = createAgent({
    evalScript: h.evalScript,
    root: "D:/Projects/reel",
    dataDir,
    panelVersion: "0.1.0",
    pollOptions: { sleep: async () => app.clock.advance(6_000) },
  });
  const pairing = a.pair(base);
  const code = await pairing.code;
  await app.app.inject({
    method: "POST",
    url: "/api/devices/confirm",
    headers: { cookie },
    payload: { user_code: code.user_code, approve: true },
  });
  const credentials = await pairing.done;
  await waitFor(a, "connected");
  return { agent: a, h, cookie, credentials, dataDir };
}

describe("production WS: device token", () => {
  it("kabinetdan yuborilgan op AE'da bajariladi; AE versiyasi qurilmaga yoziladi", async () => {
    const s = await start();
    t = s.app;
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;

    const run = (body: unknown) =>
      s.app.app.inject({
        method: "POST",
        url: `/api/devices/${p.credentials.device_id}/ops`,
        headers: { cookie: p.cookie },
        payload: body as object,
      });
    const comp = await run(
      makeOp("comp.create", "main.comp", 0, { name: "MAIN", w: 1080, h: 1920, fps: 30, dur: 5 }),
    );
    expect(comp.json()).toMatchObject({ ok: true, data: { reused: false } });
    const bad = await run(
      makeOp("layer.add_text", "t1", 1, {
        comp: "nope",
        text: "x",
        start: 0,
        style: {},
        pos: [0, 0],
      }),
    );
    expect(bad.json()).toMatchObject({ ok: false, error: { code: "AE_NOT_FOUND" } });
    expect(p.h.ae.app.project.numItems).toBe(1);

    const devices = await eventually(
      async () =>
        (await s.app.app.inject({ url: "/api/devices", headers: { cookie: p.cookie } })).json()
          .data,
      (list: { ae_version: string | null }[]) => list[0]?.ae_version === "25.2.0x15",
    );
    expect(devices[0]).toMatchObject({ ae_version: "25.2.0x15", last_seen_at: expect.any(String) });
  });

  it("revoke: qurilma uziladi, token rad etiladi va panel hisobni o'chiradi", async () => {
    const s = await start();
    t = s.app;
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    expect(existsSync(credentialsPath(p.dataDir))).toBe(true);

    await s.app.app.inject({
      method: "POST",
      url: `/api/devices/${p.credentials.device_id}/revoke`,
      headers: { cookie: p.cookie },
    });
    await waitFor(p.agent, "unauthorized", 15_000);
    expect(p.agent.account()).toBeNull();
    expect(existsSync(credentialsPath(p.dataDir))).toBe(false);

    const offline = await s.app.app.inject({
      method: "POST",
      url: `/api/devices/${p.credentials.device_id}/ops`,
      headers: { cookie: p.cookie },
      payload: makeOp("ping", "p", 0, {}),
    });
    expect(offline.statusCode).toBe(404);
  });

  it("heartbeat javobsiz qolsa server uzadi, panel o'zi qayta ulanadi", async () => {
    const s = await start();
    t = s.app;
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    expect(s.app.app.hub.isOnline(p.credentials.device_id)).toBe(true);

    s.app.clock.advance(31_000);
    s.app.app.hub.beat();
    expect(s.app.app.hub.isOnline(p.credentials.device_id)).toBe(false);
    await waitFor(p.agent, "disconnected");
    await waitFor(p.agent, "connected", 15_000);
    expect(s.app.app.hub.isOnline(p.credentials.device_id)).toBe(true);
  });

  it("server qayta ishga tushsa saqlangan token bilan qayta ulanadi; ulanmagan qurilma → 503", async () => {
    const s = await start();
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    const port = Number(new URL(s.base).port);

    await s.app.app.close();
    await waitFor(p.agent, "disconnected");
    const restarted = await start(port, s.app.db);
    t = restarted.app;
    await waitFor(p.agent, "connected", 20_000);

    p.agent.disconnect();
    await eventually(
      async () => restarted.app.app.hub.isOnline(p.credentials.device_id),
      (v) => !v,
    );
    const offline = await restarted.app.app.inject({
      method: "POST",
      url: `/api/devices/${p.credentials.device_id}/ops`,
      headers: { cookie: p.cookie },
      payload: makeOp("ping", "p", 0, {}),
    });
    expect(offline.json()).toMatchObject({ ok: false, error: { code: "ENV_AGENT_OFFLINE" } });
  });
});
