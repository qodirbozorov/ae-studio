#!/usr/bin/env node
/** ZXP'ni versiya bilan nomlaydi: `dist/zxp/com.aestudio.panel.zxp` → `release/ae-studio-<versiya>.zxp` (+ sha256). */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const panelDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(panelDir, "package.json"), "utf8"));
const source = path.join(panelDir, "dist", "zxp", "com.aestudio.panel.zxp");
if (!existsSync(source)) {
  console.error(`ZXP topilmadi: ${source} (avval pnpm zxp)`);
  process.exit(1);
}
const outDir = path.join(panelDir, "release");
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, `ae-studio-${pkg.version}.zxp`);
copyFileSync(source, target);
const sha = createHash("sha256").update(readFileSync(target)).digest("hex");
writeFileSync(`${target}.sha256`, `${sha}  ${path.basename(target)}\n`);
// O'rnatish skriptlari ZXP yonida (P5.11): foydalanuvchi bitta papkani oladi.
for (const script of ["install-panel.ps1", "install-panel.sh"]) {
  copyFileSync(
    path.join(panelDir, "..", "..", "scripts", "install", script),
    path.join(outDir, script),
  );
}
console.log(`${path.relative(panelDir, target)}  sha256 ${sha}`);
