/** E2E yordamchilari: haqiqiy server (PGlite) + device flow bilan juftlangan agent (mock AE). */
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp, login } from "../../server/test/helpers/app";
import type { TestApp } from "../../server/test/helpers/app";
import { createAgent } from "../src/agent/index";
import type { Agent, ConnectionStatus } from "../src/agent/index";
import type { MockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

/** Bo'sh TCP port (PUBLIC_URL oldindan ma'lum bo'lishi uchun — imzolangan URL'lar shunga yasaladi). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export async function start(
  port?: number,
  db?: TestApp["db"],
  extra: Parameters<typeof createTestApp>[2] = {},
  env: Record<string, string> = {},
) {
  const listenPort = port ?? (await freePort());
  const base = `http://127.0.0.1:${listenPort}`;
  const app = await createTestApp({ PUBLIC_URL: base, ...env }, db, extra);
  await app.app.listen({ port: listenPort, host: "127.0.0.1" });
  return { app, base };
}

export function waitFor(a: Agent, status: ConnectionStatus, timeoutMs = 8_000): Promise<void> {
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

export async function eventually<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Haqiqiy device flow: kod → kabinetda tasdiq → token → WS. */
export async function pairedAgent(
  app: TestApp,
  base: string,
  dataDir = mkdtempSync(join(tmpdir(), "aes-e2e-")),
  root = "D:/Projects/reel",
  ae?: MockAE,
) {
  const h = await loadJsx(ae);
  const cookie = await login(app, `owner-${Date.now()}@x.uz`);
  const a = createAgent({
    evalScript: h.evalScript,
    root,
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
