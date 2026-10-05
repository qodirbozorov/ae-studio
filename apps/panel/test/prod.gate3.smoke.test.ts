/**
 * P3.12 production gate: Claude connector oqimi (DCR + PKCE token) → production `/mcp` → shu kompyuterdagi
 * agent (mock AE + ffmpeg + soxta aerender) — `runReelScenario` to'liq. Faqat qo'lda:
 *   AES_PROD_URL=https://… AES_PROD_COOKIE='aes_session=…' pnpm vitest run apps/panel/test/prod.gate3.smoke.test.ts
 * Oxirida OAuth ulanishi va qurilma bekor qilinadi.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent/index";
import { createMockAE } from "./ae-mock";
import { waitFor } from "./e2e-helpers";
import { loadJsx } from "./jsx-harness";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";
import { runReelScenario } from "./reel-scenario";
import type { McpCall, McpCaller } from "./reel-scenario";

const BASE = process.env.AES_PROD_URL;
const COOKIE = process.env.AES_PROD_COOKIE;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

async function json(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, init);
  return response.json() as Promise<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Claude connector kabi: DCR → ruxsat (sessiya bilan) → PKCE token. */
async function connectorToken(): Promise<{ token: string; clientId: string }> {
  const reg = await json("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "AE Studio gate", redirect_uris: [CALLBACK] }),
  });
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: reg.client_id,
    redirect_uri: CALLBACK,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "gate",
    scope: "mcp offline_access",
    resource: `${BASE}/mcp`,
  });
  const page = await (
    await fetch(`${BASE}/oauth/authorize?${params}`, { headers: { cookie: COOKIE! } })
  ).text();
  const fields = Object.fromEntries(
    [...page.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1]!,
      m[2]!
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    ]),
  );
  const approved = await fetch(`${BASE}/oauth/authorize`, {
    method: "POST",
    headers: { cookie: COOKIE!, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, decision: "allow" }),
    redirect: "manual",
  });
  const code = new URL(approved.headers.get("location")!).searchParams.get("code")!;
  const tokens = await json("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: CALLBACK,
      client_id: reg.client_id,
      resource: `${BASE}/mcp`,
    }),
  });
  expect(tokens.access_token).toEqual(expect.any(String));
  return { token: tokens.access_token, clientId: reg.client_id };
}

/** Production `/mcp` ga JSON-RPC (stateless). */
function mcpCaller(token: string): McpCaller {
  let id = 0;
  return {
    async call(name, args = {}): Promise<McpCall> {
      const body = await json("/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      if (body.error !== undefined) throw new Error(JSON.stringify(body.error));
      const content = body.result.content as {
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }[];
      return {
        result: JSON.parse(content.find((c) => c.type === "text")!.text!),
        images: content
          .filter((c) => c.type === "image")
          .map((c) => ({ data: c.data!, mimeType: c.mimeType! })),
        isError: body.result.isError === true,
      };
    },
  };
}

describe.skipIf(!BASE || !COOKIE || !FFMPEG_AVAILABLE)("production: Faza 3 gate", () => {
  it("Claude connector → MCP → brief → build → VERIFY patch → render → hisobot", async () => {
    const root = mkdtempSync(join(tmpdir(), "aes-pgate-")).replace(/\\/g, "/");
    makeSourceFolder(root);
    const ae = createMockAE({ realDisk: true });
    const h = await loadJsx(ae);
    const agent = createAgent({
      evalScript: h.evalScript,
      root: "",
      dataDir: mkdtempSync(join(tmpdir(), "aes-pgate-data-")),
      panelVersion: "gate",
    });
    let clientId: string | null = null;
    try {
      const pairing = agent.pair(BASE!);
      const code = await pairing.code;
      await json("/api/devices/confirm", {
        method: "POST",
        headers: { cookie: COOKIE!, "content-type": "application/json" },
        body: JSON.stringify({ user_code: code.user_code, approve: true }),
      });
      await pairing.done;
      await waitFor(agent, "connected", 20_000);
      const ffmpegDir = findFfmpegDir() ?? null;
      agent.updateSettings({
        ffmpeg_dir: ffmpegDir,
        aerender_path: join(__dirname, "fixtures", "fake-aerender.mjs"),
      });
      process.env.AES_FAKE_FFMPEG =
        ffmpegDir === null
          ? "ffmpeg"
          : join(ffmpegDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

      const connector = await connectorToken();
      clientId = connector.clientId;
      const result = await runReelScenario({
        mcp: mcpCaller(connector.token),
        root,
        ae,
        timeoutMs: 180_000,
      });
      console.log(`gate OK: job ${result.jobId}, ${result.mp4}, kadrlar ${result.framesSeen}`);
      console.log(result.report);
    } finally {
      if (clientId !== null) {
        await json("/api/oauth/connections/revoke", {
          method: "POST",
          headers: { cookie: COOKIE!, "content-type": "application/json" },
          body: JSON.stringify({ client_id: clientId }),
        });
      }
      const device = agent.account()?.device_id;
      if (device !== undefined) {
        await json(`/api/devices/${device}/revoke`, {
          method: "POST",
          headers: { cookie: COOKIE! },
        });
      }
      agent.logout();
      delete process.env.AES_FAKE_RENDER_S;
      delete process.env.AES_FAKE_FFMPEG;
    }
  }, 600_000);
});
