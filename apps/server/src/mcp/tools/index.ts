/** Barcha MCP toollari (§8). */
import type { ToolDef } from "../registry";
import { assetTools } from "./assets";
import { envTools } from "./env";
import { projectTools } from "./projects";
import { specTools } from "./spec";

export const TOOLS: readonly ToolDef[] = [
  ...envTools,
  ...projectTools,
  ...assetTools,
  ...specTools,
];
