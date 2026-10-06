/** `pnpm gen:docs`: MCP tool ma'lumotnomasi va xato kodlari jadvalini `docs/` ga yozadi (P5.12). */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorsMarkdown, toolsMarkdown } from "../src/docs/generate";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs");
writeFileSync(path.join(docs, "mcp-tools.md"), toolsMarkdown());
writeFileSync(path.join(docs, "errors.md"), errorsMarkdown());
console.log("docs/mcp-tools.md, docs/errors.md yangilandi");
