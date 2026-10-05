/**
 * Production OAuth + MCP smoke (P3.11): Claude connector bajaradigan oqim.
 *   AES_URL=https://… AES_COOKIE='aes_session=…' node scripts/oauth-smoke.mjs
 * 401 challenge → PRM → AS metadata → DCR (Claude callback) → ruxsat ekrani (sessiya) → kod → PKCE token →
 * MCP (SDK klient): initialize, tools/list, env_check → refresh rotation → ulanishni uzish (tozalash).
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.AES_URL;
const COOKIE = process.env.AES_COOKIE;
if (!BASE || !COOKIE) {
  console.error("AES_URL va AES_COOKIE kerak");
  process.exit(2);
}
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const step = (name, value) => console.log(`✔ ${name}${value === undefined ? "" : `: ${value}`}`);
const fail = (message) => {
  console.error(`✘ ${message}`);
  process.exit(1);
};

// 1. 401 challenge
const challenge = await fetch(`${BASE}/mcp`, {
  method: "POST",
  body: "{}",
  headers: { "content-type": "application/json" },
});
const wwwAuth = challenge.headers.get("www-authenticate") ?? "";
if (challenge.status !== 401 || !wwwAuth.includes("resource_metadata="))
  fail(`401 challenge: ${challenge.status} ${wwwAuth}`);
const prmUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)[1];
step("401 + WWW-Authenticate", prmUrl);

// 2. Metadata
const prm = await (await fetch(prmUrl)).json();
if (prm.resource !== `${BASE}/mcp`) fail(`PRM resource: ${prm.resource}`);
const as = await (
  await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)
).json();
if (!as.code_challenge_methods_supported?.includes("S256")) fail("S256 yo'q");
step("metadata", `issuer=${as.issuer}, CIMD=${as.client_id_metadata_document_supported}`);

// 3. DCR
const reg = await (
  await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "AE Studio smoke",
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: "none",
    }),
  })
).json();
if (!reg.client_id) fail(`DCR: ${JSON.stringify(reg)}`);
step("DCR", reg.client_id);

// 4. Authorize (sessiya bilan) → ruxsat ekrani → allow
const verifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("hex");
const params = new URLSearchParams({
  response_type: "code",
  client_id: reg.client_id,
  redirect_uri: CALLBACK,
  code_challenge: codeChallenge,
  code_challenge_method: "S256",
  state,
  scope: "mcp offline_access",
  resource: prm.resource,
});
const page = await fetch(`${as.authorization_endpoint}?${params}`, {
  headers: { cookie: COOKIE },
  redirect: "manual",
});
if (page.status !== 200) fail(`ruxsat sahifasi: ${page.status} ${page.headers.get("location")}`);
const html = await page.text();
const fields = Object.fromEntries(
  [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
    m[1],
    m[2]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  ]),
);
const approved = await fetch(as.authorization_endpoint, {
  method: "POST",
  headers: { cookie: COOKIE, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ ...fields, decision: "allow" }),
  redirect: "manual",
});
const location = new URL(approved.headers.get("location") ?? "about:blank");
if (location.searchParams.get("state") !== state || !location.searchParams.get("code"))
  fail(`redirect: ${location}`);
step("ruxsat → kod", `${location.origin}${location.pathname}`);

// 5. Token (form-urlencoded)
const tokenRes = await fetch(as.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: location.searchParams.get("code"),
    code_verifier: verifier,
    redirect_uri: CALLBACK,
    client_id: reg.client_id,
    resource: prm.resource,
  }),
});
const tokens = await tokenRes.json();
if (!tokens.access_token || !tokens.refresh_token) fail(`token: ${JSON.stringify(tokens)}`);
step("token", `expires_in=${tokens.expires_in}, scope=${tokens.scope}`);

// 6. MCP (SDK klient)
const client = new Client({ name: "aes-smoke", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(prm.resource), {
    requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
  }),
);
const tools = await client.listTools();
const prompts = await client.listPrompts();
step("MCP initialize", `${client.getServerVersion()?.name} ${client.getServerVersion()?.version}`);
step("tools/list", `${tools.tools.length} ta: ${tools.tools.map((t) => t.name).join(", ")}`);
step("prompts/list", prompts.prompts.map((p) => p.name).join(", "));
const env = await client.callTool({ name: "env_check", arguments: {} });
step("env_check", env.content[0].text.slice(0, 200));
await client.close();

// 7. Refresh rotation
const refreshed = await (
  await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: reg.client_id,
    }),
  })
).json();
if (!refreshed.access_token || refreshed.refresh_token === tokens.refresh_token)
  fail("refresh rotation");
step("refresh rotation");

// 8. Tozalash: kabinetdan uzish
const revoke = await fetch(`${BASE}/api/oauth/connections/revoke`, {
  method: "POST",
  headers: { cookie: COOKIE, "content-type": "application/json" },
  body: JSON.stringify({ client_id: reg.client_id }),
});
const after = await fetch(prm.resource, {
  method: "POST",
  headers: {
    authorization: `Bearer ${refreshed.access_token}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
if (!revoke.ok || after.status !== 401) fail(`uzish: ${revoke.status}, keyin MCP ${after.status}`);
step("uzish → token yaroqsiz (401)");
console.log("OK");
