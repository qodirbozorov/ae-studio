/**
 * UI ↔ agent: agent alohida Node bundle (`<extension>/agent/agent.cjs`), CEP Node `require` bilan yuklanadi.
 * CEP tashqarisida (oddiy brauzerda dev) agent yo'q — UI buni ko'rsatadi.
 */
import type { Agent, AgentOptions } from "../../agent";
import pkg from "../../../package.json";
import { evalScript, extensionPath, nodeRequire, systemPath } from "./cep";

interface AgentModule {
  createAgent(options: AgentOptions): Agent;
}

let instance: Agent | null | undefined;

export function getAgent(): Agent | null {
  if (instance !== undefined) return instance;
  const ext = extensionPath();
  if (ext === null) return (instance = null);
  const mod = nodeRequire<AgentModule>(`${ext}/agent/agent.cjs`);
  instance =
    mod === null
      ? null
      : mod.createAgent({
          evalScript,
          jsxPath: `${ext}/jsx/index.js`,
          // Token shu yerda: `<userData>/.aestudio/credentials` (§4.2.5).
          dataDir: systemPath("userData") ?? undefined,
          panelVersion: pkg.version,
        });
  return instance;
}
