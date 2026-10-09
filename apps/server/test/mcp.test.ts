/**
 * P3.02: `/mcp` (Streamable HTTP) — auth challenge, SDK klient bilan initialize/list/call, yagona javob formati.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_INSTRUCTIONS } from "../src/mcp/server";
import { createTestApp, login } from "./helpers/app";
import type { TestApp } from "./helpers/app";
import { mcpSession } from "./helpers/mcp";

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
  await login(t, "mcp@x.uz");
});

afterEach(async () => {
  await t.close();
});

describe("/mcp auth", () => {
  it("tokensiz → 401 + WWW-Authenticate (resource_metadata, scope)", async () => {
    const res = await t.app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="https://aes.test/.well-known/oauth-protected-resource/mcp", scope="mcp"',
    );
    const bad = await t.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer yaroqsiz" },
      payload: {},
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers["www-authenticate"]).toContain('error="invalid_token"');
  });

  it("boshqa resource uchun berilgan token qabul qilinmaydi", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const { oauthTokens } = await import("../src/db/schema");
    const { hashToken } = await import("../src/auth/tokens");
    const { eq } = await import("drizzle-orm");
    await t.db.db
      .update(oauthTokens)
      .set({ data: { resource: "https://other.test/mcp" } })
      .where(eq(oauthTokens.hash, hashToken(s.token)));
    await expect(s.rpc("tools/list")).rejects.toThrow("401");
  });

  it("GET /mcp → 405 (stateless)", async () => {
    const res = await t.app.inject({ method: "GET", url: "/mcp" });
    expect(res.statusCode).toBe(405);
  });
});

describe("MCP protokoli", () => {
  it("SDK klient: initialize (instructions) → tools/list → tools/call", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const address = t.app.server.address() as { port: number };
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${s.token}` } },
      }),
    );
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(client.getServerVersion()?.name).toBe("ae-studio");
    const tools = await client.listTools();
    const spec = tools.tools.find((tool) => tool.name === "spec_schema");
    expect(spec).toMatchObject({
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    });
    const result = await client.callTool({ name: "spec_schema", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      data: { output_presets: ["h264_social", "h264_hq"] },
    });
    await client.close();
  });

  it("noma'lum tool va noto'g'ri argument — yagona xato formati (isError)", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const unknown = await s.call("yoq_tool");
    expect(unknown).toMatchObject({
      isError: true,
      result: { ok: false, error: { code: "SYS_NOT_FOUND" } },
    });
    const bad = await s.call("spec_schema", { extra: 1 } as never);
    // spec_schema bo'sh obyekt qabul qiladi (qo'shimcha maydonlar e'tiborsiz).
    expect(bad.result.ok).toBe(true);
  });

  it("har tool inputSchema'si JSON Schema obyekt", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const list = await s.rpc("tools/list");
    for (const tool of list.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.description).toBe("string");
    }
  });
});

describe("MCP prompts", () => {
  it("/new-reel: ro'yxatda va brief/format/papka bilan matn qaytaradi", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const list = await s.rpc("prompts/list");
    expect(list.prompts.map((p: { name: string }) => p.name)).toEqual([
      "new-reel",
      "subtitle-video",
      "dub-video",
      "from-template",
    ]);
    expect(list.prompts[0]).toMatchObject({
      arguments: expect.arrayContaining([
        expect.objectContaining({ name: "brief", required: true }),
      ]),
    });
    const got = await s.rpc("prompts/get", {
      name: "new-reel",
      arguments: {
        brief: "Kofe do'koni uchun reklama",
        format: "1:1",
        duration: "20",
        folder: "D:/Videos/kofe",
      },
    });
    const body = got.messages[0].content.text as string;
    expect(body).toContain("Kofe do'koni uchun reklama");
    expect(body).toContain("1080×1080");
    expect(body).toContain("20 s atrofida");
    expect(body).toContain("D:/Videos/kofe");
    for (const tool of [
      "env_check",
      "assets_scan",
      "plan_write",
      "preflight",
      "build_start",
      "frames_capture",
      "verify_patch",
      "report_get",
    ]) {
      expect(body).toContain(tool);
    }
    // Promptda tilga olingan barcha toollar haqiqatda mavjud.
    const tools = (await s.rpc("tools/list")).tools.map((tool: { name: string }) => tool.name);
    const mentioned = [...new Set(body.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])].filter((name) =>
      /^(env|project|assets?|spec|plan|preflight|build|job|frames|verify|render|report|el|audio|transcript|templates?|brands?|batch|contact|ae|fx|fonts|vo|preview|presets?|mogrt)_/.test(
        name,
      ),
    );
    for (const name of mentioned) expect(tools, name).toContain(name);

    const empty = await s.rpc("prompts/get", { name: "new-reel", arguments: {} });
    expect(empty.messages[0].content.text).toContain("1080×1920");
    await expect(s.rpc("prompts/get", { name: "yoq" })).rejects.toThrow();
  });
});

describe("MCP instructions", () => {
  it("instructions'da tilga olingan barcha toollar mavjud", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const tools = (await s.rpc("tools/list")).tools.map((tool: { name: string }) => tool.name);
    const mentioned = [...new Set(MCP_INSTRUCTIONS.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])].filter(
      (name) =>
        /^(env|project|assets?|spec|plan|preflight|build|job|frames|verify|render|report|el|audio|transcript|templates?|brands?|batch|contact|ae|fx|fonts|vo|preview|presets?|mogrt)_/.test(
          name,
        ),
    );
    expect(mentioned.length).toBeGreaterThan(10);
    for (const name of mentioned) expect(tools, name).toContain(name);
  });
});

describe("audio promptlari (P4.13)", () => {
  it("/new-reel audio bilan, /subtitle-video, /dub-video — tilga olingan toollar mavjud", async () => {
    const s = await mcpSession(t, "mcp@x.uz");
    const tools = (await s.rpc("tools/list")).tools.map((tool: { name: string }) => tool.name);
    const bodies: string[] = [];
    for (const [name, args] of [
      ["new-reel", { brief: "Kofe" }],
      ["subtitle-video", { video: "interview", language: "uz", style: "bold_pop" }],
      ["dub-video", { video: "interview", target_lang: "ru" }],
    ] as const) {
      const got = await s.rpc("prompts/get", { name, arguments: args });
      bodies.push(got.messages[0].content.text as string);
    }
    expect(bodies[0]).toContain("vo:0-1");
    expect(bodies[0]).toContain("el_estimate");
    expect(bodies[1]).toContain("transcript_edit");
    expect(bodies[1]).toContain("bold_pop");
    expect(bodies[2]).toContain("el_dub");
    expect(bodies[2]).toContain("ru");
    for (const body of bodies) {
      const mentioned = [...new Set(body.match(/\b[a-z]+_[a-z_]+\b/g) ?? [])].filter((name) =>
        /^(env|project|assets?|spec|plan|preflight|build|job|frames|verify|render|report|el|audio|transcript|templates?|brands?|batch|contact|ae|fx|fonts|vo|preview|presets?|mogrt)_/.test(
          name,
        ),
      );
      for (const name of mentioned) expect(tools, name).toContain(name);
    }
  });
});
