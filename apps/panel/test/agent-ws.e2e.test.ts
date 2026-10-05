/**
 * Uchidan-uchigacha (P2.05): device flow bilan juftlangan panel agenti ↔ server `/ws/agent` (device token)
 * ↔ jsx bundle (mock AE). Kabinetdan op → AE → natija; revoke; heartbeat; server qayta ishga tushishi.
 */
import { makeOp } from "@aes/shared";
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import { credentialsPath } from "../src/agent/credentials";
import type { Agent } from "../src/agent/index";
import { eventually, pairedAgent, start, waitFor } from "./e2e-helpers";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

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
