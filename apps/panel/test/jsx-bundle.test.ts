import { parse, tokenizer } from "acorn";
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
  it("ExtendScript ES3 regex: literal ichida escape qilinmagan `/` yo'q (hatto [...] ichida)", () => {
    const bad: string[] = [];
    for (const token of tokenizer(code, { ecmaVersion: 5, locations: true })) {
      if (token.type.label !== "regexp") continue;
      const pattern = (token as unknown as { value: { pattern: string } }).value.pattern;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "/") {
          bad.push(`${token.loc!.start.line}: /${pattern}/`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("obyekt/massiv literallarida oxirgi vergul yo'q (ES3)", () => {
    const tokens = [...tokenizer(code, { ecmaVersion: 5, locations: true })];
    const bad: number[] = [];
    tokens.forEach((token, i) => {
      const next = tokens[i + 1];
      if (
        token.type.label === "," &&
        next !== undefined &&
        (next.type.label === "}" || next.type.label === "]")
      ) {
        bad.push(token.loc!.start.line);
      }
    });
    expect(bad).toEqual([]);
  });

  it("to'liq ASCII va faqat LF (ExtendScript kodirovka va yakka CR muammosi)", () => {
    expect(code.includes("\r")).toBe(false);
    expect(/[\u0080-￿]/.test(code)).toBe(false);
    // Bolt include izohi alohida qatorda: json2 izoh ichida qolib ketmaydi.
    expect(code).toMatch(/EXTENDSCRIPT INCLUDES ------ \/\/\n/);
  });

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
