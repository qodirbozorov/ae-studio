/**
 * Uchidan-uchigacha (P1.13): server `/ws/agent` ↔ panel agenti (`ws`, Bearer token) ↔ jsx bundle (mock AE).
 * `POST /dev/op` → `op.run` → agent → `$[NS].runOp` → `op.done` → HTTP javob.
 */
import { makeOp } from "@aes/shared";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/src/app";
import type { Db } from "../../server/src/db/client";
import { loadEnv } from "../../server/src/env";
import { createAgent } from "../src/agent/index";
import type { Agent, ConnectionStatus } from "../src/agent/index";
import { loadJsx } from "./jsx-harness";

const TOKEN = "dev-token-".padEnd(40, "x");

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await app?.close();
  app = agent = undefined;
});

async function startServer(): Promise<{ http: string; ws: string }> {
  const env = loadEnv({
    DATABASE_URL: "postgresql://x@localhost/x",
    REDIS_URL: "redis://localhost:6379",
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DEV_AGENT_TOKEN: TOKEN,
  });
  app = await buildApp({
    env,
    db: {} as Db,
    redis: { ping: async () => "PONG", quit: async () => "OK" },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws/agent` };
}

function waitFor(agentInstance: Agent, status: ConnectionStatus, timeoutMs = 5_000): Promise<void> {
  const client = agentInstance.connection();
  if (client === null) throw new Error("ulanish yo'q");
  if (client.status() === status) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("holat kutildi: " + status)), timeoutMs);
    const off = client.onStatus((next) => {
      if (next === status) {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

async function postOp(http: string, body: unknown, token = TOKEN) {
  const response = await fetch(`${http}/dev/op`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("dev WS: server ↔ panel agent ↔ ExtendScript", () => {
  it("serverdan yuborilgan op AE'da bajariladi va natija qaytadi", async () => {
    const urls = await startServer();
    const h = await loadJsx();
    agent = createAgent({ evalScript: h.evalScript, root: "D:/Projects/reel" });
    agent.connect({
      url: urls.ws,
      token: TOKEN,
      device: { name: "Test-PC", os: "win" },
      panelVersion: "0.1.0",
    });
    await waitFor(agent, "connected");

    const comp = await postOp(
      urls.http,
      makeOp("comp.create", "main.comp", 0, { name: "MAIN", w: 1080, h: 1920, fps: 30, dur: 5 }),
    );
    expect(comp).toMatchObject({ status: 200, body: { ok: true, data: { reused: false } } });

    const text = await postOp(
      urls.http,
      makeOp("layer.add_text", "s1.title", 1, {
        comp: "main.comp",
        text: "Salom",
        start: 0,
        style: {},
        pos: [540, 960],
      }),
    );
    expect(text.body).toMatchObject({ ok: true, data: { target: { kind: "layer" } } });
    expect(h.ae.app.project.numItems).toBe(1);

    // Live log panelda: ulanish + ⏳/✅
    const messages = agent.log.list().map((e) => e.message);
    expect(messages.some((m) => m.startsWith("🟢"))).toBe(true);
    expect(messages.filter((m) => m.startsWith("✅"))).toHaveLength(2);
  });

  it("AE xatosi HTTP javobida tasniflangan holda qaytadi", async () => {
    const urls = await startServer();
    const h = await loadJsx();
    agent = createAgent({ evalScript: h.evalScript, root: "D:/Projects/reel" });
    agent.connect({
      url: urls.ws,
      token: TOKEN,
      device: { name: "T", os: "win" },
      panelVersion: "0.1.0",
    });
    await waitFor(agent, "connected");
    const res = await postOp(
      urls.http,
      makeOp("layer.add_text", "t1", 0, {
        comp: "nope",
        text: "x",
        start: 0,
        style: {},
        pos: [0, 0],
      }),
    );
    expect(res.body).toMatchObject({ ok: false, error: { code: "AE_NOT_FOUND" } });
  });

  it("panel ulanmagan → 503 ENV_AGENT_OFFLINE; noto'g'ri token → 401", async () => {
    const urls = await startServer();
    expect(await postOp(urls.http, makeOp("ping", "p", 0, {}))).toMatchObject({
      status: 503,
      body: { ok: false, error: { code: "ENV_AGENT_OFFLINE" } },
    });
    expect(await postOp(urls.http, makeOp("ping", "p", 0, {}), "wrong")).toMatchObject({
      status: 401,
      body: { error: { code: "AUTH_INVALID" } },
    });
  });

  it("noto'g'ri token bilan WS ulanmaydi; server qayta ishga tushsa agent qayta ulanadi", async () => {
    const urls = await startServer();
    const h = await loadJsx();
    agent = createAgent({ evalScript: h.evalScript });
    const client = agent.connect({
      url: urls.ws,
      token: "wrong-token",
      device: { name: "T", os: "win" },
      panelVersion: "0.1.0",
    });
    // 401 → qayta urinish to'xtaydi (yangi juftlash kerak).
    await waitFor(agent, "unauthorized");
    expect(agent.log.list().some((e) => e.message.includes("HTTP 401"))).toBe(true);
    client.stop();

    // To'g'ri token: ulanadi, keyin ulanish uzilsa qayta ulanadi.
    agent.connect({
      url: urls.ws,
      token: TOKEN,
      device: { name: "T", os: "win" },
      panelVersion: "0.1.0",
    });
    await waitFor(agent, "connected");
    const port = new URL(urls.ws).port;
    await app!.close();
    await waitFor(agent, "disconnected");
    // Xuddi shu portda server qayta ko'tariladi.
    const env = loadEnv({
      DATABASE_URL: "postgresql://x@localhost/x",
      REDIS_URL: "redis://localhost:6379",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DEV_AGENT_TOKEN: TOKEN,
    });
    app = await buildApp({
      env,
      db: {} as Db,
      redis: { ping: async () => "PONG", quit: async () => "OK" },
    });
    await app.listen({ port: Number(port), host: "127.0.0.1" });
    await waitFor(agent, "connected", 10_000);
  });
});
