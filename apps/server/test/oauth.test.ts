/**
 * P3.01: OAuth 2.1 (MCP authorization 2025-11-25) — DCR va CIMD klientlar bilan to'liq oqim, PKCE, rotation.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";
import { redirectAllowed, validRedirectUri } from "../src/oauth/clients";
import { authenticateBearer, oauthUrls } from "../src/oauth/routes";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";

const PUBLIC = "https://aes.test";
const RESOURCE = `${PUBLIC}/mcp`;
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CIMD_ID = "https://client.example.com/oauth/metadata.json";

let t: TestApp;
let cookie: string;
let documents: Record<string, unknown>;

beforeEach(async () => {
  documents = {};
  t = await createTestApp({}, undefined, {
    oauthFetcher: async (url) => {
      if (!(url in documents)) throw new Error("404");
      return documents[url];
    },
  });
  cookie = await login(t, "oauth@x.uz");
});

afterEach(async () => {
  await t.close();
});

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

async function register(body: object = {}) {
  const res = await t.app.inject({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK], ...body },
  });
  return { status: res.statusCode, body: res.json() };
}

function authorizeUrl(params: Record<string, string>) {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    code_challenge_method: "S256",
    state: "st-1",
    scope: "mcp offline_access",
    resource: RESOURCE,
    ...params,
  }).toString()}`;
}

/** Ruxsat ekranidan "allow" bosiladi → redirect URL. */
async function approve(params: Record<string, string>, decision = "allow") {
  const page = await t.app.inject({ url: authorizeUrl(params), headers: { cookie } });
  expect(page.statusCode).toBe(200);
  const fields = Object.fromEntries(
    [...page.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [
      m[1]!,
      m[2]!
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
    ]),
  );
  const res = await t.app.inject({
    method: "POST",
    url: "/oauth/authorize",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    payload: form({ ...fields, decision }),
  });
  expect(res.statusCode).toBe(303);
  return { location: new URL(res.headers.location as string), page: page.body };
}

async function token(data: Record<string, string>, headers: Record<string, string> = {}) {
  const res = await t.app.inject({
    method: "POST",
    url: "/oauth/token",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    payload: form(data),
  });
  return { status: res.statusCode, body: res.json(), headers: res.headers };
}

const env = () =>
  loadEnv({
    DATABASE_URL: "postgresql://x@y/z",
    REDIS_URL: "redis://y",
    PUBLIC_URL: PUBLIC,
    NODE_ENV: "test",
  });
const bearer = (access: string) =>
  authenticateBearer({ db: t.db.db, now: () => t.clock.now, env: env() }, `Bearer ${access}`);

/** DCR + PKCE oqimi → tokenlar. */
async function fullFlow() {
  const client = (await register()).body;
  const { verifier, challenge } = pkce();
  const { location } = await approve({
    client_id: client.client_id,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge,
  });
  const code = location.searchParams.get("code")!;
  const tokens = await token({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE_CALLBACK,
    client_id: client.client_id,
    resource: RESOURCE,
  });
  return { client, code, verifier, tokens };
}

describe("metadata", () => {
  it("RFC 9728 va RFC 8414 hujjatlari Claude talablariga mos", async () => {
    const prm = (await t.app.inject({ url: "/.well-known/oauth-protected-resource/mcp" })).json();
    expect(prm).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [PUBLIC],
      scopes_supported: ["mcp"],
    });
    const root = (await t.app.inject({ url: "/.well-known/oauth-protected-resource" })).json();
    expect(root.resource).toBe(RESOURCE);
    const as = (await t.app.inject({ url: "/.well-known/oauth-authorization-server" })).json();
    expect(as).toMatchObject({
      issuer: PUBLIC,
      authorization_endpoint: `${PUBLIC}/oauth/authorize`,
      token_endpoint: `${PUBLIC}/oauth/token`,
      registration_endpoint: `${PUBLIC}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
    });
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    expect(as.scopes_supported).toContain("offline_access");
    expect(oauthUrls("https://a.b/").resource).toBe("https://a.b/mcp");
  });
});

describe("DCR + PKCE", () => {
  it("to'liq oqim: register → login → ruxsat → kod → token → bearer", async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({
      token_endpoint_auth_method: "none",
      redirect_uris: [CLAUDE_CALLBACK],
    });
    expect(reg.body.client_secret).toBeUndefined();

    // Sessiyasiz → kabinet login'iga, qaytish manzili bilan.
    const { challenge } = pkce();
    const anon = await t.app.inject({
      url: authorizeUrl({
        client_id: reg.body.client_id,
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge: challenge,
      }),
    });
    expect(anon.statusCode).toBe(303);
    const next = new URL(anon.headers.location as string, PUBLIC).searchParams.get("next")!;
    expect(next.startsWith("/oauth/authorize?")).toBe(true);

    const { tokens, client } = await fullFlow();
    expect(tokens.status).toBe(200);
    expect(tokens.headers["cache-control"]).toBe("no-store");
    expect(tokens.body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp offline_access",
    });
    const who = await bearer(tokens.body.access_token);
    expect(who).toMatchObject({ clientId: client.client_id, scope: "mcp offline_access" });
    expect(await bearer("noto'g'ri")).toBeNull();
    // Refresh token access sifatida qabul qilinmaydi.
    expect(await bearer(tokens.body.refresh_token)).toBeNull();
  });

  it("ruxsat sahifasi: ilova nomi, qaytish host'i, CSRF; rad etish → access_denied", async () => {
    const client = (await register({ client_name: "<b>Claude</b>" })).body;
    const { challenge } = pkce();
    const params = {
      client_id: client.client_id,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
    };
    const { location, page } = await approve(params, "deny");
    expect(page).toContain("&lt;b&gt;Claude&lt;/b&gt;");
    expect(page).toContain("claude.ai");
    expect(page).toContain("oauth@x.uz");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("st-1");
    expect(location.searchParams.get("iss")).toBe(PUBLIC);

    const forged = await t.app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      payload: form({
        ...params,
        response_type: "code",
        code_challenge_method: "S256",
        decision: "allow",
        csrf: "x",
      }),
    });
    expect(forged.statusCode).toBe(403);
  });

  it("kod bir martalik; noto'g'ri verifier/redirect/resource rad etiladi", async () => {
    const { client, code, verifier } = await fullFlow();
    const again = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: client.client_id,
    });
    expect(again).toMatchObject({ status: 400, body: { error: "invalid_grant" } });

    const { challenge } = pkce();
    const fresh = await approve({
      client_id: client.client_id,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
    });
    const bad = await token({
      grant_type: "authorization_code",
      code: fresh.location.searchParams.get("code")!,
      code_verifier: pkce().verifier,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: client.client_id,
    });
    expect(bad.body.error).toBe("invalid_grant");

    const other = pkce();
    const second = await approve({
      client_id: client.client_id,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: other.challenge,
    });
    const wrongResource = await token({
      grant_type: "authorization_code",
      code: second.location.searchParams.get("code")!,
      code_verifier: other.verifier,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: client.client_id,
      resource: "https://evil.test/mcp",
    });
    expect(wrongResource.body.error).toBe("invalid_target");
  });

  it("refresh rotation; eski refresh qayta ishlatilsa butun oila bekor", async () => {
    const { client, tokens } = await fullFlow();
    const r1 = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    expect(r1.status).toBe(200);
    expect(r1.body.refresh_token).not.toBe(tokens.body.refresh_token);
    expect(await bearer(r1.body.access_token)).not.toBeNull();

    const reuse = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    expect(reuse).toMatchObject({ status: 400, body: { error: "invalid_grant" } });
    // Oila bekor: yangi tokenlar ham ishlamaydi.
    expect(await bearer(r1.body.access_token)).toBeNull();
    const r2 = await token({
      grant_type: "refresh_token",
      refresh_token: r1.body.refresh_token,
      client_id: client.client_id,
    });
    expect(r2.body.error).toBe("invalid_grant");
  });

  it("access token 1 soatdan keyin eskiradi", async () => {
    const { tokens } = await fullFlow();
    t.clock.advance(3_601_000);
    expect(await bearer(tokens.body.access_token)).toBeNull();
  });

  it("PKCE va response_type majburiy; noma'lum redirect — sahifa, redirect emas", async () => {
    const client = (await register()).body;
    const noPkce = await t.app.inject({
      url: authorizeUrl({
        client_id: client.client_id,
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge_method: "plain",
        code_challenge: "x".repeat(43),
      }),
      headers: { cookie },
    });
    expect(noPkce.statusCode).toBe(303);
    const loc = new URL(noPkce.headers.location as string);
    expect(loc.origin + loc.pathname).toBe(CLAUDE_CALLBACK);
    expect(loc.searchParams.get("error")).toBe("invalid_request");

    const evil = await t.app.inject({
      url: authorizeUrl({
        client_id: client.client_id,
        redirect_uri: "https://evil.test/cb",
        code_challenge: pkce().challenge,
      }),
      headers: { cookie },
    });
    expect(evil.statusCode).toBe(400);
    expect(evil.headers.location).toBeUndefined();

    const unknown = await t.app.inject({
      url: authorizeUrl({
        client_id: "aes_nope",
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge: pkce().challenge,
      }),
    });
    expect(unknown.statusCode).toBe(400);

    const target = await t.app.inject({
      url: authorizeUrl({
        client_id: client.client_id,
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge: pkce().challenge,
        resource: "https://other.test/mcp",
      }),
      headers: { cookie },
    });
    expect(new URL(target.headers.location as string).searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  it("DCR validatsiyasi: http (loopback emas) va noma'lum grant rad etiladi", async () => {
    expect((await register({ redirect_uris: ["http://evil.test/cb"] })).body.error).toBe(
      "invalid_redirect_uri",
    );
    expect((await register({ grant_types: ["client_credentials"] })).body.error).toBe(
      "invalid_client_metadata",
    );
    expect((await register({ redirect_uris: [] })).status).toBe(400);
  });

  it("confidential klient: client_secret_basic talab qilinadi", async () => {
    const client = (await register({ token_endpoint_auth_method: "client_secret_basic" })).body;
    expect(client.client_secret).toEqual(expect.any(String));
    const { verifier, challenge } = pkce();
    const { location } = await approve({
      client_id: client.client_id,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
    });
    const code = location.searchParams.get("code")!;
    const base = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: CLAUDE_CALLBACK,
    };
    const noSecret = await token({ ...base, client_id: client.client_id });
    expect(noSecret).toMatchObject({ status: 401, body: { error: "invalid_client" } });
    const basic = Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64");
    const okRes = await token(base, { authorization: `Basic ${basic}` });
    expect(okRes.status).toBe(200);
  });

  it("revoke va kabinetdagi 'ulangan ilovalar'", async () => {
    const { client, tokens } = await fullFlow();
    const list = await t.app.inject({ url: "/api/oauth/connections", headers: { cookie } });
    expect(list.json().data).toEqual([
      expect.objectContaining({
        client_id: client.client_id,
        client_name: "Claude",
        redirect_hosts: ["claude.ai"],
        active_tokens: 2,
      }),
    ]);
    const rev = await t.app.inject({
      method: "POST",
      url: "/oauth/revoke",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form({ token: tokens.body.access_token, client_id: client.client_id }),
    });
    expect(rev.statusCode).toBe(200);
    expect(await bearer(tokens.body.access_token)).toBeNull();

    await t.app.inject({
      method: "POST",
      url: "/api/oauth/connections/revoke",
      headers: { cookie },
      payload: { client_id: client.client_id },
    });
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    expect(refreshed.body.error).toBe("invalid_grant");
    expect(
      (await t.app.inject({ url: "/api/oauth/connections", headers: { cookie } })).json().data,
    ).toEqual([]);
  });
});

describe("CIMD (Client ID Metadata Document)", () => {
  it("URL client_id: hujjat olinadi, loopback redirect port'siz mos keladi", async () => {
    documents[CIMD_ID] = {
      client_id: CIMD_ID,
      client_name: "Claude Code",
      redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
      token_endpoint_auth_method: "none",
    };
    const { verifier, challenge } = pkce();
    const redirect = "http://localhost:53187/callback";
    const { location, page } = await approve({
      client_id: CIMD_ID,
      redirect_uri: redirect,
      code_challenge: challenge,
    });
    expect(page).toContain("Claude Code");
    expect(page).toContain("⚠️");
    const tokens = await token({
      grant_type: "authorization_code",
      code: location.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: redirect,
      client_id: CIMD_ID,
    });
    expect(tokens.status).toBe(200);
    expect(await bearer(tokens.body.access_token)).toMatchObject({ clientId: CIMD_ID });
  });

  it("hujjatdagi client_id URL'ga teng bo'lmasa yoki yo'q bo'lsa — xato sahifa", async () => {
    documents[CIMD_ID] = {
      client_id: "https://boshqa.example.com/x.json",
      client_name: "X",
      redirect_uris: [CLAUDE_CALLBACK],
    };
    const res = await t.app.inject({
      url: authorizeUrl({
        client_id: CIMD_ID,
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge: pkce().challenge,
      }),
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    const missing = await t.app.inject({
      url: authorizeUrl({
        client_id: "https://none.example.com/c.json",
        redirect_uri: CLAUDE_CALLBACK,
        code_challenge: pkce().challenge,
      }),
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(400);
  });
});

describe("redirect qoidalari (sof)", () => {
  it("validRedirectUri va loopback port'siz moslik", () => {
    expect(validRedirectUri(CLAUDE_CALLBACK)).toBe(true);
    expect(validRedirectUri("http://localhost:3000/cb")).toBe(true);
    expect(validRedirectUri("http://evil.test/cb")).toBe(false);
    expect(validRedirectUri("https://a.test/cb#x")).toBe(false);
    expect(redirectAllowed([CLAUDE_CALLBACK], CLAUDE_CALLBACK)).toBe(true);
    expect(redirectAllowed([CLAUDE_CALLBACK], `${CLAUDE_CALLBACK}?x=1`)).toBe(false);
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:9999/callback")).toBe(
      true,
    );
    expect(redirectAllowed(["http://127.0.0.1/callback"], "http://127.0.0.1:9999/other")).toBe(
      false,
    );
    expect(redirectAllowed(["https://a.test/cb"], "https://a.test:444/cb")).toBe(false);
  });
});

describe("CIMD SSRF himoyasi", () => {
  it("ichki manzillarga so'rov yuborilmaydi", async () => {
    const { fetchClientMetadata } = await import("../src/oauth/clients");
    for (const url of [
      "https://127.0.0.1/c.json",
      "https://10.0.0.5/c.json",
      "https://169.254.169.254/latest",
      "https://[::1]/c.json",
      "https://localhost/c.json",
    ]) {
      await expect(fetchClientMetadata(url)).rejects.toMatchObject({ error: "invalid_client" });
    }
  });
});

describe("OAuth audit (P3.10)", () => {
  it("ruxsat, refresh qayta ishlatish va uzish jurnalga yoziladi", async () => {
    const { client, tokens } = await fullFlow();
    await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    await token({
      grant_type: "refresh_token",
      refresh_token: tokens.body.refresh_token,
      client_id: client.client_id,
    });
    await t.app.inject({
      method: "POST",
      url: "/api/oauth/connections/revoke",
      headers: { cookie },
      payload: { client_id: client.client_id },
    });
    const log = await t.app.inject({ url: "/api/audit", headers: { cookie } });
    expect(log.json().data.map((row: { action: string }) => row.action)).toEqual([
      "oauth.revoked",
      "oauth.refresh_reuse",
      "oauth.authorized",
    ]);
    expect(log.json().data[2]).toMatchObject({ actor: "user", target: "Claude" });
  });
});
