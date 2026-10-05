/** MCP test yordamchilari: user uchun access token va `/mcp` ga JSON-RPC (inject orqali). */
import { eq } from "drizzle-orm";
import { issueToken } from "../../src/auth/tokens";
import { devices, oauthClients, users } from "../../src/db/schema";
import type { TestApp } from "./app";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- testlarda javob shakli assert'larda tekshiriladi
type Json = any;

export interface McpSession {
  token: string;
  userId: string;
  /** Tool chaqiradi: `{ ok, data | error }` (text content'dan) va rasmlar. */
  call(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ result: Json; images: { data: string; mimeType: string }[]; isError: boolean }>;
  rpc(method: string, params?: unknown): Promise<Json>;
}

let counter = 0;

/** `email` user'i uchun test klienti va access token (resource = PUBLIC_URL/mcp). */
export async function mcpSession(t: TestApp, email: string): Promise<McpSession> {
  const [user] = await t.db.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user === undefined) throw new Error(`user yo'q: ${email}`);
  const clientId = `test_client_${++counter}_${Date.now()}`;
  await t.db.db.insert(oauthClients).values({
    id: clientId,
    clientName: "Test",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  // Server o'z resource'ini e'lon qiladi (PUBLIC_URL testga qarab farq qiladi).
  const resource = (await t.app.inject({ url: "/.well-known/oauth-protected-resource/mcp" })).json()
    .resource as string;
  const { token } = await issueToken(t.db.db, {
    kind: "access",
    ttlMs: 3_600_000,
    now: t.clock.now,
    userId: user.id,
    clientId,
    scope: "mcp",
    data: { resource },
  });
  let id = 0;
  const rpc = async (method: string, params?: unknown) => {
    const response = await t.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2025-11-25",
      },
      payload: { jsonrpc: "2.0", id: ++id, method, ...(params === undefined ? {} : { params }) },
    });
    if (response.statusCode !== 200) {
      throw new Error(`MCP HTTP ${response.statusCode}: ${response.body}`);
    }
    const body = response.json();
    if (body.error !== undefined) throw new Error(`MCP xato: ${JSON.stringify(body.error)}`);
    return body.result;
  };
  return {
    token,
    userId: user.id,
    rpc,
    async call(name, args = {}) {
      const result = await rpc("tools/call", { name, arguments: args });
      const text = result.content.find((c: { type: string }) => c.type === "text");
      return {
        result: JSON.parse(text.text),
        images: result.content.filter((c: { type: string }) => c.type === "image"),
        isError: result.isError === true,
      };
    },
  };
}

/** Qurilma egasi uchun MCP sessiya (panel e2e testlari: drizzle'ni panelga olib kirmaslik uchun). */
export async function mcpSessionForDevice(t: TestApp, deviceId: string): Promise<McpSession> {
  const [row] = await t.db.db
    .select({ email: users.email })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (row === undefined) throw new Error(`qurilma yo'q: ${deviceId}`);
  return mcpSession(t, row.email);
}
