// Server bundle: workspace paketlari (@aes/*, TS manba) ichiga olinadi, npm bog'liqliklari tashqarida qoladi.
import { build } from "esbuild";
import { existsSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith("@aes/"));

const entryPoints = { index: "src/index.ts" };
if (existsSync("src/db/migrate-cli.ts")) entryPoints.migrate = "src/db/migrate-cli.ts";

rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints,
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
  logLevel: "info",
});
