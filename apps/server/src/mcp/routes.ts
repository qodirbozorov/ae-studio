/**
 * `/mcp` — Streamable HTTP (stateless, JSON javoblar). Bearer token → user (P3.01);
 * token yo'q yoki yaroqsiz → 401 + `WWW-Authenticate` (resource_metadata, scope) — Claude shu bilan login'ni boshlaydi.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppContext } from "../context";
import type { JobEngine } from "../jobs/engine";
import { authenticateBearer, bearerChallenge } from "../oauth/routes";
import { PROMPTS } from "./prompts";
import { createMcpServer, mcpRateLimiter } from "./server";
import { TOOLS } from "./tools";

export interface McpHooks {
  /** Har autentifikatsiyalangan MCP so'rovi (Claude indikatori uchun). */
  onRequest?: (userId: string) => void;
  onCall?: (userId: string, clientId: string, tool: string, ok: boolean, mutating: boolean) => void;
}

export function registerMcpRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  engine: JobEngine,
  hooks: McpHooks = {},
): void {
  const limiter = mcpRateLimiter(ctx.now);

  app.post("/mcp", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const auth = await authenticateBearer(ctx, request.headers.authorization);
    if (auth === null) {
      const hasToken = /^Bearer\s+\S+/i.test(request.headers.authorization ?? "");
      return reply
        .code(401)
        .header(
          "www-authenticate",
          bearerChallenge(ctx.env.PUBLIC_URL, hasToken ? "invalid_token" : undefined),
        )
        .send({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Avtorizatsiya kerak" },
          id: null,
        });
    }
    hooks.onRequest?.(auth.userId);
    const server = createMcpServer({
      tools: TOOLS,
      prompts: PROMPTS,
      limiter,
      context: { app: ctx, engine, userId: auth.userId, clientId: auth.clientId, log: request.log },
      onCall: (tool, ok) =>
        hooks.onCall?.(
          auth.userId,
          auth.clientId,
          tool,
          ok,
          TOOLS.find((def) => def.name === tool)?.annotations?.readOnlyHint !== true,
        ),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error({ err: error }, "mcp so'rovi xatosi");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Ichki xato" },
            id: null,
          }),
        );
      }
    }
  });

  // Stateless: server → klient SSE oqimi va sessiyalar yo'q.
  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply
      .code(405)
      .header("allow", "POST")
      .send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
