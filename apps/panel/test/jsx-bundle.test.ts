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
