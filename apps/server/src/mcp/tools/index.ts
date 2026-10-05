/** Barcha MCP toollari (§8). */
import type { ToolDef } from "../registry";
import { envTools } from "./env";
import { projectTools } from "./projects";
import { specTools } from "./spec";

export const TOOLS: readonly ToolDef[] = [...envTools, ...projectTools, ...specTools];
