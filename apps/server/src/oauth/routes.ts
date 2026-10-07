/**
 * OAuth 2.1 authorization server (§4.1) — Claude custom connector uchun.
 * - Metadata: RFC 9728 (`/.well-known/oauth-protected-resource[/mcp]`), RFC 8414 (`/.well-known/oauth-authorization-server`).
 * - `/oauth/authorize`: kabinet sessiyasi + ruxsat ekrani; PKCE S256 majburiy; `resource` (RFC 8707) tekshiriladi.
 * - `/oauth/token`: authorization_code va refresh_token (rotation, qayta ishlatishda butun oila bekor qilinadi).
 * - `/oauth/revoke` (RFC 7009), `/oauth/register` (DCR), CIMD.
 * Tokenlar opaque, DB'da faqat sha256 (`oauth_tokens`): access 1 soat, refresh 30 kun.
 */
import { createHash, randomBytes } from "node:crypto";
import { fail, ok } from "@aes/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loadSession, requireUser } from "../auth/session";
import { consumeToken, findActiveToken, hashToken, issueToken } from "../auth/tokens";
import type { TokenRow } from "../auth/tokens";
import type { AppContext } from "../context";
import { oauthClients, oauthTokens } from "../db/schema";
import { audit } from "../audit";
import { RateLimiter } from "../lib/rate-limit";
import {
  OAuthError,
  fetchClientMetadata,
  isLoopback,
  redirectAllowed,
  registerClient,
  resolveClient,
  secretMatches,
} from "./clients";
import type { ClientRow, MetadataFetcher } from "./clients";
import { consentPage, errorPage } from "./consent";

export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
const CODE_TTL_MS = 10 * 60_000;
/** Asosiy scope; `offline_access` — refresh token (Claude uni metadata'da ko'rsa so'raydi). */
export const MCP_SCOPE = "mcp";
const SUPPORTED_SCOPES = [MCP_SCOPE, "offline_access"];

export interface OAuthUrls {
  issuer: string;
  /** MCP server'ning kanonik URI'si (RFC 8707 `resource`, PRM `resource`). */
  resource: string;
  resourceMetadata: string;
}

export function oauthUrls(publicUrl: string): OAuthUrls {
  const issuer = publicUrl.replace(/\/+$/, "");
  return {
    issuer,
    resource: `${issuer}/mcp`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
  };
}

/** Kanonik shakl: scheme/host kichik harf, oxirgi `/` siz (MCP spec tavsiyasi). */
function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash !== "") return null;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
  } catch {
    return null;
  }
}

function sameResource(a: string, b: string): boolean {
  const x = canonicalResource(a);
  return x !== null && x === canonicalResource(b);
}

/** Bearer → token egasi (faqat shu MCP server uchun berilgan access token). */
export async function authenticateBearer(
  ctx: Pick<AppContext, "db" | "now" | "env">,
  header: string | undefined,
): Promise<{ userId: string; clientId: string; scope: string; tokenId: string } | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (match === null) return null;
  const row = await findActiveToken(ctx.db, "access", match[1]!, ctx.now());
  if (row === null || row.userId === null || row.clientId === null) return null;
  const resource = typeof row.data?.resource === "string" ? row.data.resource : "";
  if (!sameResource(resource, oauthUrls(ctx.env.PUBLIC_URL).resource)) return null;
  return { userId: row.userId, clientId: row.clientId, scope: row.scope ?? "", tokenId: row.id };
}

/** `/mcp` 401 javobi uchun sarlavha (MCP spec: resource_metadata + scope). */
export function bearerChallenge(publicUrl: string, error?: "invalid_token"): string {
  const urls = oauthUrls(publicUrl);
  const parts = [`resource_metadata="${urls.resourceMetadata}"`, `scope="${MCP_SCOPE}"`];
  if (error !== undefined) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function grantScope(requested: string | undefined): string {
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  const granted = asked.filter((s) => SUPPORTED_SCOPES.includes(s));
  if (!granted.includes(MCP_SCOPE)) granted.unshift(MCP_SCOPE);
  return [...new Set(granted)].join(" ");
}

const authorizeSchema = z.object({
  response_type: z.string().optional(),
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2000).optional(),
});
type AuthorizeParams = z.output<typeof authorizeSchema>;

export interface OAuthOptions {
  /** CIMD hujjatlarini olish (testlarda almashtiriladi). */
  fetcher?: MetadataFetcher;
}

export function registerOAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  options: OAuthOptions = {},
): void {
  const urls = oauthUrls(ctx.env.PUBLIC_URL);
  const fetcher = options.fetcher ?? fetchClientMetadata;
  const csrfSecret = ctx.env.JWT_SIGNING_KEY ?? randomBytes(32).toString("hex");
  const registerLimit = new RateLimiter(30, 60 * 60_000, () => ctx.now().getTime());
  const tokenLimit = new RateLimiter(120, 60_000, () => ctx.now().getTime());

  const csrfFor = (sessionId: string) =>
    createHash("sha256").update(`${sessionId}:${csrfSecret}`).digest("base64url");

  const oauthReply = (reply: FastifyReply, error: OAuthError) =>
    reply
      .code(error.status)
      .header("cache-control", "no-store")
      .send({ error: error.error, error_description: error.description });

  // ---------------------------------------------------------------- metadata

  const protectedResource = () => ({
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "AE Studio",
  });
  app.get("/.well-known/oauth-protected-resource", async () => protectedResource());
  app.get("/.well-known/oauth-protected-resource/mcp", async () => protectedResource());

  const authorizationServer = () => ({
    issuer: urls.issuer,
    authorization_endpoint: `${urls.issuer}/oauth/authorize`,
    token_endpoint: `${urls.issuer}/oauth/token`,
    registration_endpoint: `${urls.issuer}/oauth/register`,
    revocation_endpoint: `${urls.issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    scopes_supported: SUPPORTED_SCOPES,
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  });
  app.get("/.well-known/oauth-authorization-server", async () => authorizationServer());

  // ---------------------------------------------------------------- DCR

  app.post("/oauth/register", async (request, reply) => {
    if (!registerLimit.take(request.ip)) {
      return oauthReply(reply, new OAuthError("invalid_request", "Juda ko'p so'rov", 429));
    }
    try {
      const client = await registerClient(ctx.db, request.body, ctx.now());
      return reply.code(201).header("cache-control", "no-store").send(client);
    } catch (error) {
      if (error instanceof OAuthError) return oauthReply(reply, error);
      throw error;
    }
  });

  // ---------------------------------------------------------------- authorize

  /**
   * Parametrlarni tekshiradi. Klient yoki redirect_uri noto'g'ri bo'lsa — foydalanuvchiga xato sahifasi
   * (begona manzilga redirect qilinmaydi); qolgan xatolar redirect_uri ga `error=` bilan qaytadi.
   */
  async function validateAuthorize(
    raw: unknown,
  ): Promise<
    | { kind: "page"; message: string }
    | { kind: "redirect"; url: string }
    | { kind: "ok"; params: AuthorizeParams; client: ClientRow; resource: string; scope: string }
  > {
    const parsed = authorizeSchema.safeParse(raw);
    if (!parsed.success) return { kind: "page", message: "client_id va redirect_uri kerak" };
    const params = parsed.data;
    let client: ClientRow;
    try {
      client = await resolveClient(ctx.db, params.client_id, ctx.now(), fetcher);
    } catch (error) {
      if (error instanceof OAuthError) return { kind: "page", message: error.description };
      throw error;
    }
    if (!redirectAllowed(client.redirectUris, params.redirect_uri)) {
      return { kind: "page", message: "redirect_uri bu ilova uchun ro'yxatdan o'tmagan" };
    }
    const back = (error: string, description: string) => {
      const url = new URL(params.redirect_uri);
      url.searchParams.set("error", error);
      url.searchParams.set("error_description", description);
      if (params.state !== undefined) url.searchParams.set("state", params.state);
      url.searchParams.set("iss", urls.issuer);
      return { kind: "redirect" as const, url: url.toString() };
    };
    if (params.response_type !== "code") {
      return back("unsupported_response_type", "Faqat response_type=code");
    }
    if (
      params.code_challenge === undefined ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(params.code_challenge) ||
      params.code_challenge_method !== "S256"
    ) {
      return back("invalid_request", "PKCE majburiy: code_challenge_method=S256");
    }
    const resource = params.resource ?? urls.resource;
    if (!sameResource(resource, urls.resource)) {
      return back("invalid_target", `resource ${urls.resource} bo'lishi kerak`);
    }
    return { kind: "ok", params, client, resource: urls.resource, scope: grantScope(params.scope) };
  }

  app.get("/oauth/authorize", async (request, reply) => {
    const checked = await validateAuthorize(request.query);
    if (checked.kind === "page")
      return reply.code(400).type("text/html").send(errorPage(checked.message));
    if (checked.kind === "redirect") return reply.redirect(checked.url, 303);
    await loadSession(ctx, request);
    if (request.user === null) {
      return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 303);
    }
    const { params, client } = checked;
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) if (value !== undefined) fields[key] = value;
    // form-action yo'naltirish manziliga ham qo'llanadi: POST'dan keyingi 303 mijozning redirect_uri
    // origin'iga (masalan https://claude.ai) ruxsat etilmasa brauzer uni bloklaydi va oqim tugamaydi.
    const redirect = new URL(params.redirect_uri);
    const redirectOrigin = redirect.origin === "null" ? redirect.protocol : redirect.origin;
    return reply
      .header("x-frame-options", "DENY")
      .header(
        "content-security-policy",
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${redirectOrigin}`,
      )
      .header("cache-control", "no-store")
      .type("text/html")
      .send(
        consentPage({
          clientName: client.clientName ?? "Noma'lum ilova",
          clientId: client.id,
          redirectHost: new URL(params.redirect_uri).host,
          loopbackOnly: client.redirectUris.every(isLoopback),
          email: request.user.name,
          fields,
          csrf: csrfFor(request.user.sessionId),
        }),
      );
  });

  app.post("/oauth/authorize", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, string>;
    const checked = await validateAuthorize(body);
    if (checked.kind === "page")
      return reply.code(400).type("text/html").send(errorPage(checked.message));
    if (checked.kind === "redirect") return reply.redirect(checked.url, 303);
    await loadSession(ctx, request);
    if (request.user === null || body.csrf !== csrfFor(request.user.sessionId)) {
      return reply
        .code(403)
        .type("text/html")
        .send(errorPage("Sessiya tugagan. Qaytadan urinib ko'ring."));
    }
    const { params, client, resource, scope } = checked;
    const target = new URL(params.redirect_uri);
    if (params.state !== undefined) target.searchParams.set("state", params.state);
    target.searchParams.set("iss", urls.issuer);
    await audit(ctx, request.log, {
      userId: request.user.id,
      actor: "user",
      action: body.decision === "allow" ? "oauth.authorized" : "oauth.denied",
      target: client.clientName ?? client.id,
      ip: request.ip,
      data: { client_id: client.id, redirect_host: target.host, scope },
    });
    if (body.decision !== "allow") {
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("error_description", "Foydalanuvchi rad etdi");
      return reply.redirect(target.toString(), 303);
    }
    const { token } = await issueToken(ctx.db, {
      kind: "auth_code",
      ttlMs: CODE_TTL_MS,
      now: ctx.now(),
      userId: request.user.id,
      clientId: client.id,
      scope,
      data: {
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
        resource,
      },
    });
    request.log.info({ client: client.id, user: request.user.id }, "oauth: ruxsat berildi");
    target.searchParams.set("code", token);
    return reply.redirect(target.toString(), 303);
  });

  // ---------------------------------------------------------------- token

  /** Klient autentifikatsiyasi: Basic, post yoki public (`none`). */
  async function authenticateClient(request: FastifyRequest, body: Record<string, string>) {
    let clientId = body.client_id;
    let secret = body.client_secret;
    const basic = /^Basic\s+(\S+)$/i.exec(request.headers.authorization ?? "");
    if (basic !== null) {
      const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) throw new OAuthError("invalid_client", "Basic sarlavha noto'g'ri", 401);
      clientId = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    }
    if (clientId === undefined || clientId === "") {
      throw new OAuthError("invalid_client", "client_id kerak", 401);
    }
    const client = await resolveClient(ctx.db, clientId, ctx.now(), fetcher);
    if (client.tokenEndpointAuthMethod !== "none" && !secretMatches(client, secret)) {
      throw new OAuthError("invalid_client", "Klient siri noto'g'ri", 401);
    }
    return client;
  }

  async function issuePair(userId: string, client: ClientRow, scope: string, resource: string) {
    const now = ctx.now();
    const access = await issueToken(ctx.db, {
      kind: "access",
      ttlMs: ACCESS_TTL_MS,
      now,
      userId,
      clientId: client.id,
      scope,
      data: { resource },
    });
    const refresh = await issueToken(ctx.db, {
      kind: "refresh",
      ttlMs: REFRESH_TTL_MS,
      now,
      userId,
      clientId: client.id,
      scope,
      data: { resource },
    });
    return {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refresh.token,
      scope,
    };
  }

  /** Refresh token qayta ishlatildi (o'g'irlangan bo'lishi mumkin): shu user+klientning barcha tokenlari bekor. */
  async function revokeFamily(userId: string, clientId: string): Promise<void> {
    await ctx.db
      .update(oauthTokens)
      .set({ revokedAt: ctx.now() })
      .where(
        and(
          eq(oauthTokens.userId, userId),
          eq(oauthTokens.clientId, clientId),
          inArray(oauthTokens.kind, ["access", "refresh"]),
          isNull(oauthTokens.revokedAt),
        ),
      );
  }

  async function tokenByHash(token: string): Promise<TokenRow | null> {
    const [row] = await ctx.db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.hash, hashToken(token)))
      .limit(1);
    return row ?? null;
  }

  app.post("/oauth/token", async (request, reply) => {
    if (!tokenLimit.take(request.ip)) {
      return oauthReply(reply, new OAuthError("invalid_request", "Juda ko'p so'rov", 429));
    }
    const body = (request.body ?? {}) as Record<string, string>;
    try {
      const client = await authenticateClient(request, body);
      if (body.grant_type === "authorization_code") {
        if (!body.code || !body.code_verifier || !body.redirect_uri) {
          throw new OAuthError("invalid_request", "code, code_verifier va redirect_uri kerak");
        }
        const row = await consumeToken(ctx.db, "auth_code", body.code, ctx.now());
        if (row === null || row.userId === null || row.clientId !== client.id) {
          throw new OAuthError("invalid_grant", "Kod yaroqsiz yoki ishlatilgan");
        }
        const data = row.data ?? {};
        if (data.redirect_uri !== body.redirect_uri) {
          throw new OAuthError("invalid_grant", "redirect_uri mos emas");
        }
        if (
          !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier) ||
          pkceS256(body.code_verifier) !== data.code_challenge
        ) {
          throw new OAuthError("invalid_grant", "PKCE tekshiruvidan o'tmadi");
        }
        const resource = String(data.resource);
        if (body.resource !== undefined && !sameResource(body.resource, resource)) {
          throw new OAuthError("invalid_target", "resource mos emas");
        }
        const tokens = await issuePair(row.userId, client, row.scope ?? MCP_SCOPE, resource);
        return reply.header("cache-control", "no-store").header("pragma", "no-cache").send(tokens);
      }
      if (body.grant_type === "refresh_token") {
        if (!body.refresh_token) throw new OAuthError("invalid_request", "refresh_token kerak");
        const row = await consumeToken(ctx.db, "refresh", body.refresh_token, ctx.now());
        if (row === null) {
          const stale = await tokenByHash(body.refresh_token);
          if (stale !== null && stale.kind === "refresh" && stale.revokedAt !== null) {
            if (stale.userId !== null && stale.clientId !== null) {
              await revokeFamily(stale.userId, stale.clientId);
            }
            request.log.warn({ client: stale.clientId }, "oauth: refresh token qayta ishlatildi");
            await audit(ctx, request.log, {
              userId: stale.userId,
              actor: "system",
              action: "oauth.refresh_reuse",
              target: stale.clientId,
              ip: request.ip,
            });
          }
          throw new OAuthError("invalid_grant", "Refresh token yaroqsiz");
        }
        if (row.userId === null || row.clientId !== client.id) {
          throw new OAuthError("invalid_grant", "Refresh token bu klientga tegishli emas");
        }
        const resource = String(row.data?.resource ?? urls.resource);
        if (body.resource !== undefined && !sameResource(body.resource, resource)) {
          throw new OAuthError("invalid_target", "resource mos emas");
        }
        let scope = row.scope ?? MCP_SCOPE;
        if (body.scope !== undefined) {
          const narrowed = body.scope.split(/\s+/).filter((s) => scope.split(" ").includes(s));
          if (narrowed.length === 0)
            throw new OAuthError("invalid_scope", "Scope kengaytirilmaydi");
          scope = narrowed.join(" ");
        }
        const tokens = await issuePair(row.userId, client, scope, resource);
        return reply.header("cache-control", "no-store").header("pragma", "no-cache").send(tokens);
      }
      throw new OAuthError("unsupported_grant_type", "authorization_code yoki refresh_token");
    } catch (error) {
      if (error instanceof OAuthError) return oauthReply(reply, error);
      throw error;
    }
  });

  app.post("/oauth/revoke", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, string>;
    try {
      const client = await authenticateClient(request, body);
      if (body.token) {
        const row = await tokenByHash(body.token);
        if (
          row !== null &&
          row.clientId === client.id &&
          (row.kind === "access" || row.kind === "refresh") &&
          row.revokedAt === null
        ) {
          await ctx.db
            .update(oauthTokens)
            .set({ revokedAt: ctx.now() })
            .where(eq(oauthTokens.id, row.id));
        }
      }
      return reply.header("cache-control", "no-store").send({});
    } catch (error) {
      if (error instanceof OAuthError) return oauthReply(reply, error);
      throw error;
    }
  });

  // ---------------------------------------------------------------- kabinet: ulangan ilovalar

  app.get("/api/oauth/connections", { preHandler: requireUser }, async (request) => {
    const rows = await ctx.db
      .select({ token: oauthTokens, client: oauthClients })
      .from(oauthTokens)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
      .where(
        and(
          eq(oauthTokens.userId, request.user!.id),
          inArray(oauthTokens.kind, ["access", "refresh"]),
          isNull(oauthTokens.revokedAt),
        ),
      )
      .orderBy(desc(oauthTokens.createdAt));
    const now = ctx.now().getTime();
    const byClient = new Map<string, { client: ClientRow; last: Date; active: number }>();
    for (const { token, client } of rows) {
      if (token.expiresAt !== null && token.expiresAt.getTime() <= now) continue;
      const entry = byClient.get(client.id) ?? { client, last: token.createdAt, active: 0 };
      entry.active++;
      if (token.createdAt > entry.last) entry.last = token.createdAt;
      byClient.set(client.id, entry);
    }
    return ok(
      [...byClient.values()].map(({ client, last, active }) => ({
        client_id: client.id,
        client_name: client.clientName,
        kind: client.kind,
        redirect_hosts: [...new Set(client.redirectUris.map((uri) => new URL(uri).host))],
        last_authorized_at: last,
        active_tokens: active,
      })),
    );
  });

  app.post("/api/oauth/connections/revoke", { preHandler: requireUser }, async (request, reply) => {
    const parsed = z
      .strictObject({ client_id: z.string().min(1).max(2000) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(fail("SYS_BAD_REQUEST", "client_id kerak"));
    await revokeFamily(request.user!.id, parsed.data.client_id);
    request.log.info({ client: parsed.data.client_id }, "oauth: ilova uzildi");
    await audit(ctx, request.log, {
      userId: request.user!.id,
      actor: "user",
      action: "oauth.revoked",
      target: parsed.data.client_id,
      ip: request.ip,
    });
    return ok({ revoked: true });
  });
}
