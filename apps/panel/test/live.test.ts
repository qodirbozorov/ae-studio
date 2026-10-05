/** P2.12: Live ekrani holati (agent tomonidagi store). */
import { describe, expect, it } from "vitest";
import { LiveJobStore } from "../src/agent/live";

const update = (over: object = {}) => ({
  type: "job.update" as const,
  job_id: "j1",
  state: "BUILD" as const,
  progress: { done: 3, total: 10 },
  paused: false,
  ...over,
});

const event = (message: string, job_id = "j1") => ({
  type: "job.event" as const,
  job_id,
  event: { ts: "2026-10-05T10:00:00.000Z", level: "info" as const, type: "x", message },
});

describe("LiveJobStore", () => {
  it("job.update: yangi job tarixni tozalaydi; sahna BUILD davomida saqlanadi", () => {
    const store = new LiveJobStore();
    let notified = 0;
    store.subscribe(() => notified++);
    expect(store.applyUpdate(update({ scene_id: "hook" }))).toBe(true);
    store.applyEvent(event("a"));
    expect(store.applyUpdate(update({ progress: { done: 4, total: 10 } }))).toBe(false);
    expect(store.current()).toMatchObject({ scene_id: "hook", progress: { done: 4 } });
    expect(store.events()).toHaveLength(1);
    // Boshqa job hodisasi qabul qilinmaydi.
    store.applyEvent(event("b", "j2"));
    expect(store.events()).toHaveLength(1);

    store.applyUpdate(update({ state: "VERIFY" }));
    expect(store.current()?.scene_id).toBeUndefined();
    expect(store.applyUpdate(update({ job_id: "j2", state: "CHECK" }))).toBe(true);
    expect(store.events()).toHaveLength(0);
    expect(notified).toBe(5);
  });

  it("setHistory jonli hodisalar bilan dublikatsiz birlashadi", () => {
    const store = new LiveJobStore();
    store.applyUpdate(update());
    store.applyEvent(event("live"));
    store.setHistory("j1", [event("old").event, event("live").event]);
    expect(store.events().map((e) => e.message)).toEqual(["old", "live"]);
    store.setHistory("boshqa", [event("x").event]);
    expect(store.events()).toHaveLength(2);
  });

  it("BLOCKED xatosi va pauza", () => {
    const store = new LiveJobStore();
    store.applyUpdate(
      update({
        state: "BLOCKED",
        prev_state: "BUILD",
        paused: true,
        error: { code: "AE_SCRIPT_ERROR", retryable: false, hint: "h" },
      }),
    );
    expect(store.current()).toMatchObject({
      state: "BLOCKED",
      prev_state: "BUILD",
      paused: true,
      error: { code: "AE_SCRIPT_ERROR" },
    });
  });
});

describe("claudeIndicator", () => {
  it("faol (15 daqiqa), ulangan, ulanmagan, noma'lum", async () => {
    const { claudeIndicator } = await import("../src/agent/claude");
    const now = Date.parse("2026-10-05T10:00:00Z");
    expect(claudeIndicator(null, now)).toBe("unknown");
    expect(claudeIndicator({ linked: false, last_seen_at: null }, now)).toBe("off");
    expect(claudeIndicator({ linked: true, last_seen_at: null }, now)).toBe("linked");
    expect(claudeIndicator({ linked: true, last_seen_at: "2026-10-05T09:50:00Z" }, now)).toBe(
      "active",
    );
    expect(claudeIndicator({ linked: true, last_seen_at: "2026-10-05T09:40:00Z" }, now)).toBe(
      "linked",
    );
  });
});

describe("AudioStore", () => {
  it("ro'yxat, upsert, loyiha filtri, yangi birinchi", async () => {
    const { AudioStore } = await import("../src/agent/audio-store");
    const store = new AudioStore();
    let changes = 0;
    store.subscribe(() => changes++);
    const base = {
      kind: "tts" as const,
      label: null,
      status: "queued" as const,
      job_id: null,
      local_path: null,
      duration_s: null,
      cached: false,
      error: null,
    };
    store.replace([
      { ...base, id: "a", project_id: "p1", created_at: "2026-10-05T10:00:00.000Z" },
      { ...base, id: "b", project_id: "p2", created_at: "2026-10-05T10:01:00.000Z" },
    ]);
    store.upsert({
      ...base,
      id: "a",
      project_id: "p1",
      status: "done",
      created_at: "2026-10-05T10:00:00.000Z",
    });
    store.upsert({ ...base, id: "c", project_id: "p1", created_at: "2026-10-05T10:02:00.000Z" });
    expect(store.list("p1").map((t) => [t.id, t.status])).toEqual([
      ["c", "queued"],
      ["a", "done"],
    ]);
    expect(store.list().map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(changes).toBe(3);
  });
});
