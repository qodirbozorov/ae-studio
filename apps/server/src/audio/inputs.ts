/**
 * Kirish audiosi (P4.04): loyiha faylidan panel ovozni ajratib (`audio.extract.request`) storage'ga
 * (`audio-in`) yuklaydi → `InputRef` (sha256 kesh kalitiga kiradi).
 */
import { randomUUID } from "node:crypto";
import { fail, ok } from "@aes/shared";
import type { Result } from "@aes/shared";
import type { AppContext } from "../context";
import type { projects } from "../db/schema";
import { resolveProjectPath } from "../projects/routes";
import { storageKey } from "../storage";
import type { InputRef } from "./service";

const EXTRACT_TIMEOUT_MS = 15 * 60_000;
const EXT = { opus: "ogg", wav: "wav", mp3: "mp3" } as const;
const MIME = { opus: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg" } as const;

export async function extractInput(
  ctx: Pick<AppContext, "hub" | "storage">,
  project: typeof projects.$inferSelect,
  localPath: string,
  options: { format?: "opus" | "wav" | "mp3"; name?: string } = {},
): Promise<Result<InputRef>> {
  if (project.deviceId === null || !ctx.hub.isOnline(project.deviceId)) {
    return fail("ENV_AGENT_OFFLINE", "Loyiha qurilmasida panel ulanmagan");
  }
  const inside = resolveProjectPath(project, localPath);
  if (!inside.ok) return inside;
  const format = options.format ?? "opus";
  const key = storageKey({
    userId: project.userId,
    projectId: project.id,
    kind: "audio-in",
    hash: `in${randomUUID().replace(/-/g, "")}`,
    ext: EXT[format],
  });
  const reply = await ctx.hub.request(
    project.deviceId,
    {
      type: "audio.extract.request",
      request_id: randomUUID(),
      local_path: localPath,
      format,
      mono: true,
      upload: {
        url: await ctx.storage.presignPut(key, { contentType: MIME[format] }),
        storage_key: key,
      },
    },
    EXTRACT_TIMEOUT_MS,
  );
  if (!reply.ok) return reply;
  if (reply.data.type !== "file.uploaded") return fail("SYS_INTERNAL", "Kutilmagan javob");
  if ((await ctx.storage.head(key)) === null) {
    return fail("ASSET_MISSING", "Ajratilgan audio storage'ga yetib kelmadi");
  }
  return ok({
    name: options.name ?? "audio",
    storage_key: key,
    sha256: reply.data.sha256,
    duration_s: reply.data.duration_s ?? null,
  });
}
