import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TestApp } from "../../server/test/helpers/app";
import type { Agent } from "../src/agent/index";
import { PROJECT_FOLDERS } from "../src/agent/workspace";
import { pairedAgent, start } from "./e2e-helpers";

let t: TestApp | undefined;
let agent: Agent | undefined;

afterEach(async () => {
  agent?.disconnect();
  await t?.close();
  t = agent = undefined;
});

describe("ish papkasi (§11.1.2)", () => {
  it("papka tayyorlanadi, serverda loyiha bo'ladi va oxirgilar ro'yxatida chiqadi", async () => {
    const s = await start();
    t = s.app;
    const p = await pairedAgent(s.app, s.base);
    agent = p.agent;

    const folder = mkdtempSync(join(tmpdir(), "aes-ws-"));
    const project = await p.agent.openProject(folder);
    for (const sub of PROJECT_FOLDERS) expect(existsSync(join(folder, sub)), sub).toBe(true);
    expect(project.root_path).toBe(folder.replace(/\\/g, "/"));
    expect(p.agent.getRoot()).toBe(project.root_path);
    expect(p.agent.currentProject()?.id).toBe(project.id);

    const again = await p.agent.openProject(folder);
    expect(again.id).toBe(project.id);
    expect((await p.agent.recentProjects()).map((x) => x.id)).toEqual([project.id]);

    await expect(p.agent.openProject(join(folder, "yoq-papka"))).rejects.toThrow(/topilmadi/);
  });

  it("sozlamalar diskka saqlanadi va yangi agentda o'qiladi", async () => {
    const s = await start();
    t = s.app;
    const dataDir = mkdtempSync(join(tmpdir(), "aes-set-"));
    const p = await pairedAgent(s.app, s.base, dataDir);
    agent = p.agent;
    expect(p.agent.settings()).toEqual({ device_name: null, log_level: "info", ffmpeg_dir: null });
    p.agent.updateSettings({ device_name: "Studio-PC", log_level: "debug" });
    const fresh = await pairedAgent(s.app, s.base, dataDir);
    fresh.agent.disconnect();
    expect(fresh.agent.settings()).toEqual({
      device_name: "Studio-PC",
      log_level: "debug",
      ffmpeg_dir: null,
    });
  });
});
