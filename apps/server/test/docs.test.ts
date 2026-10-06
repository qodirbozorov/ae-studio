/** P5.12: generatsiya qilingan hujjatlar kod bilan mos (yangi tool/xato qo'shilsa `pnpm gen:docs`). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_DEFS } from "@aes/shared";
import { errorsMarkdown, toolsMarkdown } from "../src/docs/generate";
import { TOOLS } from "../src/mcp/tools";

const docs = path.resolve(__dirname, "..", "..", "..", "docs");
const read = (name: string) => readFileSync(path.join(docs, name), "utf8").replace(/\r\n/g, "\n");

describe("hujjatlar (P5.12)", () => {
  it("docs/mcp-tools.md va docs/errors.md eskirmagan (pnpm gen:docs)", () => {
    expect(read("mcp-tools.md")).toBe(toolsMarkdown());
    expect(read("errors.md")).toBe(errorsMarkdown());
  });

  it("har tool va har xato kodi hujjatda; guruhsiz qolmagan", () => {
    const tools = toolsMarkdown();
    for (const tool of TOOLS) expect(tools).toContain(`### \`${tool.name}\``);
    expect(tools).not.toContain("## Boshqa");
    const errors = errorsMarkdown();
    for (const code of Object.keys(ERROR_DEFS)) expect(errors).toContain(`\`${code}\``);
    expect(errors).not.toContain("## Boshqa");
  });
});
