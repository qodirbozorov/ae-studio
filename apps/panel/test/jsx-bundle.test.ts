import { parse } from "acorn";
import vm from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
import { JSX_VERSION, NS } from "../src/shared/constants";
import { generateJsx } from "../vite.es.config";

let code: string;

beforeAll(async () => {
  code = await generateJsx();
}, 60_000);

/** ExtendScript'ga o'xshash muhit: JSON yo'q, faqat `$` global obyekti. */
function extendScriptContext() {
  const context = vm.createContext({ $: {} });
  vm.runInContext("delete this.JSON;", context);
  return context;
}

describe("ExtendScript bundle", () => {
  it("ES3 parser'dan o'tadi (ExtendScript sintaksisi)", () => {
    expect(() => parse(code, { ecmaVersion: 3 })).not.toThrow();
  });

  it("JSON yo'q muhitda json2 polyfill o'rnatadi va $[NS] ro'yxatdan o'tadi", () => {
    const context = extendScriptContext();
    expect(vm.runInContext("typeof JSON", context)).toBe("undefined");
    vm.runInContext(code, context);
    expect(vm.runInContext('JSON.stringify({ a: [1, "x"], b: null })', context)).toBe(
      '{"a":[1,"x"],"b":null}',
    );
    const api = (context.$ as Record<string, { version: string }>)[NS];
    expect(api?.version).toBe(JSX_VERSION);
  });

  it("bundle ES5+ API'larni ishlatmaydi (Babel inline helper'lari ham)", () => {
    for (const forbidden of [
      "Object.defineProperty",
      "Object.keys(",
      "Symbol.iterator",
      ".forEach(",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

describe("ae-smoke.jsx (AE ichida qo'lda ishga tushiriladi)", () => {
  it("ES3 parser'dan o'tadi", async () => {
    const { readFileSync } = await import("node:fs");
    const smoke = readFileSync(new URL("../src/js/public/ae-smoke.jsx", import.meta.url), "utf8");
    expect(() => parse(smoke, { ecmaVersion: 3 })).not.toThrow();
  });
});

describe("ae-smoke.jsx mock AE'da", () => {
  it("barcha tekshiruvlar OK", async () => {
    const { readFileSync } = await import("node:fs");
    const { createMockAE } = await import("./ae-mock");
    const smoke = readFileSync(new URL("../src/js/public/ae-smoke.jsx", import.meta.url), "utf8");
    const ae = createMockAE();
    const alerts: string[] = [];
    const ext = "C:/ext/com.aestudio.panel";
    const context = vm.createContext({
      ...ae.globals,
      alert: (text: string) => alerts.push(text),
      Folder: { temp: { fsName: "C:/Temp" } },
      File: function (path: string) {
        return path === ext + "/ae-smoke.jsx"
          ? { parent: { fsName: ext } }
          : { fsName: path, exists: path === ext + "/jsx/index.js" };
      },
    });
    vm.runInContext("delete this.JSON;", context);
    Object.assign(context.$ as object, {
      fileName: ext + "/ae-smoke.jsx",
      evalFile: () => vm.runInContext(code, context),
    });
    vm.runInContext(smoke, context);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("HAMMASI OK");
    expect(alerts[0]).not.toContain("FAIL");
  });
});
