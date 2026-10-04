import { describe, expect, it } from "vitest";
import { JSX_VERSION } from "../src/shared/constants";
import { createMockAE } from "./ae-mock";
import { loadJsx } from "./jsx-harness";

describe("runOp dispatcher (§10.3)", () => {
  it("ping: AE va jsx versiyasi, loyiha yo'li; undo group ochilmaydi", async () => {
    const h = await loadJsx();
    const res = h.run("ping", "p1", { echo: "salom" });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.data).toMatchObject({
      op_id: "p1",
      reused: false,
      info: {
        ae_version: "25.2.0x15",
        jsx_version: JSX_VERSION,
        project_path: null,
        echo: "salom",
      },
    });
    expect(h.ae.app.undoGroups).toEqual([]);
    expect(h.ae.app.suppressDialogs).toBe(0);
  });

  it("JSON bo'lmagan so'rov → AE_BAD_PARAMS (natija baribir JSON)", async () => {
    const h = await loadJsx();
    const res = JSON.parse(h.raw("{oops")) as { ok: boolean; error: { code: string } };
    expect(res).toMatchObject({ ok: false, error: { code: "AE_BAD_PARAMS" } });
  });

  it("noma'lum op → AE_UNKNOWN_OP", async () => {
    const h = await loadJsx();
    const res = JSON.parse(
      h.raw(
        JSON.stringify({ op: { op_id: "x", op: "layer.delete", params: {} }, ctx: { root: "" } }),
      ),
    );
    expect(res.error.code).toBe("AE_UNKNOWN_OP");
  });

  it("eski AE (21.x) → AE_VERSION, ping esa ishlaydi", async () => {
    const h = await loadJsx(createMockAE({ version: "21.6" }));
    expect(
      h.run("comp.create", "c1", { name: "M", w: 100, h: 100, fps: 30, dur: 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: "AE_VERSION" },
    });
    expect(h.run("ping", "p", {}).ok).toBe(true);
  });
});
