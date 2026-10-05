import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import type { Agent } from "../src/agent/index";
import { eventually, pairedAgent, start } from "./e2e-helpers";
import { FFMPEG_AVAILABLE, findFfmpegDir, makeSourceFolder } from "./media";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

interface AssetDto {
  key: string;
  kind: string;
  status: string;
  thumb_key: string | null;
  meta: Record<string, unknown>;
}

describe.skipIf(!FFMPEG_AVAILABLE)("INGEST e2e: kabinet → server → panel → ffmpeg → DB", () => {
  it("skanerlash, thumbnail storage'da, qayta skanda yo'qolgan fayl 'missing'", async () => {
    const s = await start();
    t = s.app;
    const root = mkdtempSync(join(tmpdir(), "aes-ing-"));
    makeSourceFolder(root);
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    p.agent.updateSettings({ ffmpeg_dir: findFfmpegDir() ?? null });
    const project = await p.agent.openProject(root);

    const scan = await s.app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scan`,
      headers: { cookie: p.cookie },
    });
    expect(scan.json()).toMatchObject({ ok: true, data: { request_id: expect.any(String) } });

    const list = () =>
      s.app.app
        .inject({ url: `/api/projects/${project.id}/assets`, headers: { cookie: p.cookie } })
        .then((r) => (r.json() as { data: AssetDto[] }).data);
    const assets = await eventually(list, (rows) => rows.length === 6, 60_000);
    const byKey = Object.fromEntries(assets.map((a) => [a.key, a]));
    expect(byKey.clip_01).toMatchObject({ kind: "video", status: "ok", meta: { width: 1920 } });
    expect(byKey.broken?.status).toBe("corrupt");
    expect(byKey.notes?.status).toBe("unsupported");
    // Thumbnail haqiqatan storage'da.
    expect(await s.app.app.storage.head(byKey.clip_01!.thumb_key!)).not.toBeNull();

    rmSync(join(root, "source", "vo.wav"));
    await p.agent.scanAssets();
    const after = await eventually(
      list,
      (rows) => rows.find((a) => a.key === "vo")?.status === "missing",
    );
    expect(after.find((a) => a.key === "vo")?.status).toBe("missing");
  });

  it("boshqa papka ochiq bo'lsa scan rad etiladi; panel ulanmagan bo'lsa 503", async () => {
    const s = await start();
    t = s.app;
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;
    const project = await p.agent.openProject(mkdtempSync(join(tmpdir(), "aes-a-")));
    await p.agent.openProject(mkdtempSync(join(tmpdir(), "aes-b-")));

    const failures: unknown[] = [];
    s.app.app.hub.onMessage((_d, m) => {
      if (m.type === "request.failed") failures.push(m);
    });
    await s.app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scan`,
      headers: { cookie: p.cookie },
    });
    await eventually(
      async () => failures.length,
      (n) => n > 0,
    );
    expect(failures[0]).toMatchObject({ error: { code: "ENV_NO_FOLDER" } });

    p.agent.disconnect();
    await eventually(
      async () => s.app.app.hub.isOnline(p.credentials.device_id),
      (v) => !v,
    );
    const offline = await s.app.app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scan`,
      headers: { cookie: p.cookie },
    });
    expect(offline.statusCode).toBe(503);
  });
});
