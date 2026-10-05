/** Barcha MCP toollari (§8). */
import type { ToolDef } from "../registry";
import { assetTools } from "./assets";
import { audioStatusTools } from "./audio";
import { buildTools } from "./build";
import { envTools } from "./env";
import { projectTools } from "./projects";
import { renderTools } from "./render";
import { reportTools } from "./report";
import { specTools } from "./spec";
import { verifyTools } from "./verify";

export const TOOLS: readonly ToolDef[] = [
  ...envTools,
  ...projectTools,
  ...assetTools,
  ...buildTools,
  ...verifyTools,
  ...renderTools,
  ...audioStatusTools,
  ...reportTools,
  ...specTools,
];
