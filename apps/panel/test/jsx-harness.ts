import type { AeContext, AeOpName, AeResponse, OpParamsMap } from "@aes/shared/ae";
import vm from "node:vm";
import { NS } from "../src/shared/constants";
import { generateJsx } from "../vite.es.config";
import { createMockAE } from "./ae-mock";
import type { MockAE } from "./ae-mock";

let cached: Promise<string> | undefined;

/** jsx bundle bir marta build qilinadi (Babel sekin). */
export function jsxCode(): Promise<string> {
  cached ??= generateJsx();
  return cached;
}

export interface Harness {
  ae: MockAE;
  run<N extends AeOpName>(op: N, opId: string, params: OpParamsMap[N], ctx?: AeContext): AeResponse;
  raw(json: string): string;
}

/** Bundle'ni ExtendScript'ga o'xshash vm'da (JSON'siz) mock AE bilan ishga tushiradi. */
export async function loadJsx(ae: MockAE = createMockAE()): Promise<Harness> {
  const context = vm.createContext({ ...ae.globals });
  vm.runInContext("delete this.JSON;", context);
  vm.runInContext(await jsxCode(), context);
  const api = (context.$ as Record<string, { runOp(json: string): string }>)[NS];
  if (api === undefined) throw new Error("$[NS] ro'yxatdan o'tmadi");
  const raw = (json: string) => api.runOp(json);
  return {
    ae,
    raw,
    run(op, opId, params, ctx = { root: "D:/Projects/reel" }) {
      const request = { op: { op_id: opId, seq: 0, op, params, timeout_ms: 30_000 }, ctx };
      return JSON.parse(raw(JSON.stringify(request))) as AeResponse;
    },
  };
}
