/**
 * OAuth klientlari (§4.1, MCP authorization 2025-11-25):
 * - DCR (RFC 7591): `POST /oauth/register`;
 * - CIMD (Client ID Metadata Document): `client_id` — https URL, hujjat server tomonidan olinadi (SSRF himoyasi bilan).
 * Claude callback'i `https://claude.ai/api/mcp/auth_callback`; Claude Code — loopback, port ixtiyoriy.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { oauthClients } from "../db/schema";

export type ClientRow = typeof oauthClients.$inferSelect;
export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Klient hujjatini oluvchi (testlarda almashtiriladi). */
export type MetadataFetcher = (url: string) => Promise<unknown>;

export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isLoopback(uri: string): boolean {
  const url = parseUrl(uri);
  return url !== null && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Redirect URI: https yoki http loopback, fragmentsiz (OAuth 2.1 §1.5). */
export function validRedirectUri(uri: string): boolean {
  const url = parseUrl(uri);
  if (url === null || url.hash !== "" || uri.includes("#")) return false;
  if (url.protocol === "https:") return true;
  return isLoopback(uri);
}

/**
 * Aniq moslik; loopback (`localhost` / `127.0.0.1`) uchun port e'tiborga olinmaydi (RFC 8252 §7.3,
 * Claude Code har sessiyada boshqa port ishlatadi).
 */
export function redirectAllowed(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const want = new URL(requested);
  return registered.some((uri) => {
    if (!isLoopback(uri)) return false;
    const have = new URL(uri);
    return (
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(client: ClientRow, secret: string | undefined): boolean {
  if (client.secretHash === null || secret === undefined) return false;
  const a = Buffer.from(client.secretHash, "hex");
  const b = Buffer.from(hashSecret(secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- DCR

const registerSchema = z.looseObject({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
  client_name: z.string().trim().max(200).optional(),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(500).optional(),
});

export async function registerClient(db: Db, body: unknown, now: Date) {
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris (massiv) kerak");
  }
  const input = parsed.data;
  const bad = input.redirect_uris.find((uri) => !validRedirectUri(uri));
  if (bad !== undefined) {
    throw new OAuthError(
      "invalid_redirect_uri",
      `Redirect URI https yoki http://localhost bo'lishi kerak: ${bad}`,
    );
  }
  const method = (input.token_endpoint_auth_method ?? "none") as AuthMethod;
  if (!AUTH_METHODS.includes(method)) {
    throw new OAuthError("invalid_client_metadata", `token_endpoint_auth_method: ${method}`);
  }
  const grants = input.grant_types ?? ["authorization_code", "refresh_token"];
  if (grants.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Faqat authorization_code va refresh_token");
  }
  if ((input.response_types ?? ["code"]).some((r) => r !== "code")) {
    throw new OAuthError("invalid_client_metadata", "Faqat response_type=code");
  }
  const clientId = `aes_${randomBytes(18).toString("base64url")}`;
  const secret = method === "none" ? null : randomBytes(32).toString("base64url");
  await db.insert(oauthClients).values({
    id: clientId,
    clientName: input.client_name ?? null,
    redirectUris: input.redirect_uris,
    kind: "dcr",
    tokenEndpointAuthMethod: method,
    secretHash: secret === null ? null : hashSecret(secret),
    createdAt: now,
    updatedAt: now,
  });
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    ...(input.client_name === undefined ? {} : { client_name: input.client_name }),
    redirect_uris: input.redirect_uris,
    grant_types: grants,
    response_types: ["code"],
    token_endpoint_auth_method: method,
    ...(secret === null ? {} : { client_secret: secret, client_secret_expires_at: 0 }),
  };
}

// ---------------------------------------------------------------- CIMD

/** `client_id` CIMD shaklidami: https, yo'l komponenti bor. */
export function isMetadataClientId(clientId: string): boolean {
  const url = parseUrl(clientId);
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.pathname !== "/" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}

const cimdSchema = z.looseObject({
  client_id: z.string(),
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
});

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    return mapped !== null && privateAddress(mapped[1]!);
  }
  const [a, b] = address.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

const MAX_METADATA_BYTES = 64 * 1024;

/** Haqiqiy fetcher: faqat ommaviy manzillar, redirect'siz, 5 s, 64 KB. */
export const fetchClientMetadata: MetadataFetcher = async (url) => {
  const target = new URL(url);
  const addresses =
    isIP(target.hostname) !== 0
      ? [{ address: target.hostname }]
      : await lookup(target.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) {
    throw new OAuthError("invalid_client", "client_id manzili ichki tarmoqqa olib boradi");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new OAuthError("invalid_client", `client_id hujjati: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_METADATA_BYTES) throw new OAuthError("invalid_client", "Hujjat juda katta");
  return JSON.parse(text) as unknown;
};

const CIMD_TTL_MS = 5 * 60_000;

/**
 * Klientni topadi: DCR — DB'dan; CIMD — hujjat olinadi (5 daqiqa kesh), tekshiriladi va DB'ga yoziladi
 * (tokenlar `oauth_clients` ga bog'langan).
 */
export async function resolveClient(
  db: Db,
  clientId: string,
  now: Date,
  fetcher: MetadataFetcher,
): Promise<ClientRow> {
  const [row] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  if (!isMetadataClientId(clientId)) {
    if (row === undefined) throw new OAuthError("invalid_client", "Noma'lum client_id", 401);
    return row;
  }
  if (row !== undefined && now.getTime() - row.updatedAt.getTime() < CIMD_TTL_MS) return row;

  let document: unknown;
  try {
    document = await fetcher(clientId);
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError("invalid_client", "client_id hujjatini olib bo'lmadi");
  }
  const parsed = cimdSchema.safeParse(document);
  if (!parsed.success) throw new OAuthError("invalid_client", "client_id hujjati noto'g'ri");
  if (parsed.data.client_id !== clientId) {
    throw new OAuthError("invalid_client", "Hujjatdagi client_id URL'ga teng emas");
  }
  const uris = parsed.data.redirect_uris.filter(validRedirectUri);
  if (uris.length === 0) throw new OAuthError("invalid_client", "Yaroqli redirect_uris yo'q");
  const values = {
    clientName: parsed.data.client_name,
    redirectUris: uris,
    kind: "cimd",
    tokenEndpointAuthMethod: "none",
    secretHash: null,
    updatedAt: now,
  };
  const [saved] = await db
    .insert(oauthClients)
    .values({ id: clientId, createdAt: now, ...values })
    .onConflictDoUpdate({ target: oauthClients.id, set: values })
    .returning();
  return saved!;
}
