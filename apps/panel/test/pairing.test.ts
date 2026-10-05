import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, login } from "../../server/test/helpers/app";
import type { TestApp } from "../../server/test/helpers/app";
import {
  credentialsPath,
  decryptCredentials,
  encryptCredentials,
  loadCredentials,
  saveCredentials,
} from "../src/agent/credentials";
import { PairingError, createAgent } from "../src/agent/index";
import { agentSocketUrl, normalizeServerUrl } from "../src/agent/pairing";

const sample = { server_url: "https://aes.test", device_id: "d1", token: "secret-token-123" };

describe("credentials (§4.2.5)", () => {
  it("shifrlangan holda saqlanadi va shu mashinada ochiladi", () => {
    const dir = mkdtempSync(join(tmpdir(), "aes-cred-"));
    saveCredentials(dir, sample, "machine-A");
    const raw = readFileSync(credentialsPath(dir), "utf8");
    expect(raw).not.toContain("secret-token-123");
    expect(loadCredentials(dir, "machine-A")).toEqual(sample);
  });

  it("boshqa mashinada yoki buzilgan faylda ochilmaydi", () => {
    const stored = encryptCredentials(sample, "machine-A");
    expect(decryptCredentials(stored, "machine-B")).toBeNull();
    expect(
      decryptCredentials({ ...stored, data: stored.data.slice(0, -4) + "AAAA" }, "machine-A"),
    ).toBeNull();
    expect(loadCredentials(mkdtempSync(join(tmpdir(), "aes-none-")))).toBeNull();
  });

  it("server manzili normallashtiriladi", () => {
    expect(normalizeServerUrl(" https://aes.up.railway.app/ ")).toBe("https://aes.up.railway.app");
    expect(agentSocketUrl("https://aes.up.railway.app")).toBe("wss://aes.up.railway.app/ws/agent");
    expect(agentSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000/ws/agent");
    expect(() => normalizeServerUrl("ftp://x")).toThrow();
  });
});

describe("device flow: panel agent ↔ haqiqiy server", () => {
  let t: TestApp;
  let base: string;
  let cookie: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
    cookie = await login(t, "pair@x.uz");
  });

  afterAll(async () => {
    await t.close();
  });

  function newAgent(dataDir: string) {
    return createAgent({
      evalScript: async () => "{}",
      dataDir,
      // Server soati testda boshqariladi: har poll oldidan 6 s o'tkazamiz (slow_down bo'lmasin).
      pollOptions: { sleep: async () => t.clock.advance(6_000) },
    });
  }

  const confirm = (userCode: string, approve: boolean) =>
    t.app.inject({
      method: "POST",
      url: "/api/devices/confirm",
      headers: { cookie },
      payload: { user_code: userCode, approve },
    });

  it("kod → kabinetda tasdiq → token shifrlangan faylga saqlanadi", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aes-pair-"));
    const agent = newAgent(dataDir);
    expect(agent.account()).toBeNull();
    const pairing = agent.pair(base);
    const code = await pairing.code;
    expect(code.user_code).toHaveLength(6);
    expect((await confirm(code.user_code, true)).json()).toMatchObject({ ok: true });
    const credentials = await pairing.done;
    agent.disconnect();

    expect(credentials).toMatchObject({ server_url: base, device_id: expect.any(String) });
    expect(agent.account()).toEqual(credentials);
    // Yangi agent (panel qayta ochildi) saqlangan hisobni o'qiydi.
    expect(newAgent(dataDir).account()).toEqual(credentials);
    expect(agent.log.list().some((e) => e.message.includes(code.user_code))).toBe(true);
  });

  it("rad etilsa PairingError(denied), token saqlanmaydi; bekor qilish ishlaydi", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "aes-deny-"));
    const agent = newAgent(dataDir);
    const pairing = agent.pair(base);
    await confirm((await pairing.code).user_code, false);
    await expect(pairing.done).rejects.toMatchObject({ reason: "denied" });
    expect(agent.account()).toBeNull();

    const cancelled = agent.pair(base);
    await cancelled.code;
    cancelled.cancel();
    const error = await cancelled.done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PairingError);
    expect((error as PairingError).reason).toBe("cancelled");
  });
});
