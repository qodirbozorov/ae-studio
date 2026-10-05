/**
 * MCP prompts (§8): Claude'dagi tayyor buyruqlar (`/new-reel` …).
 */
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  render(args: Record<string, string>): GetPromptResult;
}

export const PROMPTS: PromptDef[] = [];
