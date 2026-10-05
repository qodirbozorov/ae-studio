/**
 * MCP tool registry (§8): har tool — zod kirish sxemasi (→ JSON Schema `inputSchema`), handler va annotatsiyalar.
 * Javob formati yagona: `{ ok: true, data } | { ok: false, error: { code, retryable, hint } }` (text content),
 * ixtiyoriy rasmlar (image content) bilan.
 */
import type { Result } from "@aes/shared";
import type { FastifyBaseLogger } from "fastify";
import type { z } from "zod";
import type { AppContext } from "../context";
import type { JobEngine } from "../jobs/engine";

export interface ToolContext {
  app: AppContext;
  engine: JobEngine;
  userId: string;
  clientId: string;
  log: FastifyBaseLogger;
}

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

/** Handler natijasi: Result (+ ixtiyoriy rasmlar). */
export type ToolOutput = Result<unknown> & { images?: ImageBlock[] };

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  handler(ctx: ToolContext, input: z.output<S>): Promise<ToolOutput>;
}

/** Tip chiqarish uchun yordamchi (`defineTool({...})`). */
export function defineTool<S extends z.ZodType>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}
