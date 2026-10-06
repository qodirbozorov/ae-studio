/** Barcha MCP toollari (§8). */
import type { ToolDef } from "../registry";
import { assetTools } from "./assets";
import { audioStatusTools } from "./audio";
import { buildTools } from "./build";
import { elevenAnalyzeTools } from "./eleven-analyze";
import { elevenGenerateTools } from "./eleven-generate";
import { elevenTransformTools } from "./eleven-transform";
import { elevenVoiceTools } from "./eleven-voice";
import { envTools } from "./env";
import { projectTools } from "./projects";
import { renderTools } from "./render";
import { reportTools } from "./report";
import { specTools } from "./spec";
import { templateTools } from "./templates";
import { brandTools } from "./brands";
import { batchTools } from "./batch";
import { verifyTools } from "./verify";

export const TOOLS: readonly ToolDef[] = [
  ...envTools,
  ...projectTools,
  ...assetTools,
  ...buildTools,
  ...verifyTools,
  ...renderTools,
  ...audioStatusTools,
  ...elevenVoiceTools,
  ...elevenGenerateTools,
  ...elevenAnalyzeTools,
  ...elevenTransformTools,
  ...templateTools,
  ...brandTools,
  ...batchTools,
  ...reportTools,
  ...specTools,
];
