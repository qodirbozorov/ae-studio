/** Barcha MCP toollari (§8). */
import type { ToolDef } from "../registry";
import { assetTools } from "./assets";
import { buildTools } from "./build";
import { envTools } from "./env";
import { projectTools } from "./projects";
import { specTools } from "./spec";
import { verifyTools } from "./verify";

export const TOOLS: readonly ToolDef[] = [
  ...envTools,
  ...projectTools,
  ...assetTools,
  ...buildTools,
  ...verifyTools,
  ...specTools,
];
