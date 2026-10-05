/**
 * Web kabinetni static qilib berish (§4.3): `apps/web/dist`. SPA: noma'lum sahifa so'rovlari `index.html` ga.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyRequest } from "fastify";

/** API va boshqa servis yo'llari — SPA fallback'ga tushmaydi. */
const API_PREFIXES = ["/api/", "/oauth/", "/ws/", "/dev/", "/mcp", "/health", "/.well-known/"];

/** `WEB_DIST` yoki yuqoriga qarab `apps/web/dist/index.html` ni qidiradi (tsx'da ham, bundle'da ham). */
export function findWebDist(
  explicit?: string,
  from = dirname(fileURLToPath(import.meta.url)),
): string | null {
  if (explicit !== undefined) return existsSync(join(explicit, "index.html")) ? explicit : null;
  let dir = from;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, "apps", "web", "dist");
    if (existsSync(join(candidate, "index.html"))) return candidate;
    const sibling = join(dir, "web", "dist");
    if (existsSync(join(sibling, "index.html"))) return sibling;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function isSpaRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const path = request.url.split("?")[0] ?? "/";
  return !API_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix),
  );
}

export async function registerWeb(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, prefix: "/", index: ["index.html"] });
}
