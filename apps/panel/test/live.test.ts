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
