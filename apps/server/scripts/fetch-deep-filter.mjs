// DeepFilterNet3 (`deep-filter` CLI) binarini apps/server/bin/ ga yuklab oladi (Railway build va lokal dev).
// Versiya va sha256 qat'iy: boshqa fayl kelsa build to'xtaydi. Litsenziya: MIT / Apache-2.0.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.5.6";
const ASSETS = {
  "linux-x64": {
    file: `deep-filter-${VERSION}-x86_64-unknown-linux-musl`,
    sha256: "70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da",
    out: "deep-filter",
  },
  "win32-x64": {
    file: `deep-filter-${VERSION}-x86_64-pc-windows-msvc.exe`,
    sha256: "75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915",
    out: "deep-filter.exe",
  },
};

const asset = ASSETS[`${process.platform}-${process.arch}`];
if (asset === undefined) {
  console.warn(
    `deep-filter: ${process.platform}-${process.arch} uchun binar yo'q — server isolation o'chiq`,
  );
  process.exit(0);
}

const binDir = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
const target = join(binDir, asset.out);
const sha = (data) => createHash("sha256").update(data).digest("hex");

if (existsSync(target) && sha(readFileSync(target)) === asset.sha256) {
  console.log(`deep-filter ${VERSION}: allaqachon bor`);
  process.exit(0);
}

const url = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}/${asset.file}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`deep-filter yuklanmadi: HTTP ${response.status}`);
const data = Buffer.from(await response.arrayBuffer());
if (sha(data) !== asset.sha256) throw new Error("deep-filter: sha256 mos kelmadi");
mkdirSync(binDir, { recursive: true });
writeFileSync(target, data);
chmodSync(target, 0o755);
console.log(`deep-filter ${VERSION} → ${target}`);
