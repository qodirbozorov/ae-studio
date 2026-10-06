import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CEP_Config } from "vite-cep-plugin";
import pkg from "./package.json" with { type: "json" };
import { MIN_AE_VERSION, NS } from "./src/shared/constants";

const config: CEP_Config = {
  version: pkg.version,
  id: NS,
  displayName: "AE Studio",
  symlink: "local",
  // Server (3000) bilan to'qnashmasligi uchun.
  port: 3100,
  servePort: 5100,
  startingDebugPort: 8860,
  extensionManifestVersion: 6.0,
  // CEP 11 = After Effects 2022 (22.0) va yangilari.
  requiredRuntimeVersion: 11.0,
  hosts: [{ name: "AEFT", version: `[${MIN_AE_VERSION.toFixed(1)},99.9]` }],
  type: "Panel",
  // src/js/public/icons → dist/cep/icons (Vite publicDir). AE qorong'i UI'da DarkNormal ishlatadi.
  iconNormal: "./icons/icon-light.png",
  iconDarkNormal: "./icons/icon-dark.png",
  iconNormalRollOver: "./icons/icon-hover.png",
  iconDarkNormalRollOver: "./icons/icon-hover.png",
  parameters: ["--v=0", "--enable-nodejs", "--mixed-context"],
  width: 420,
  height: 640,
  panels: [
    {
      mainPath: "./main/index.html",
      name: "main",
      panelDisplayName: "AE Studio",
      autoVisible: true,
      width: 420,
      height: 640,
      minWidth: 320,
      minHeight: 400,
    },
  ],
  build: {
    jsxBin: "off",
    sourceMap: true,
  },
  zxp: {
    country: "UZ",
    province: "Toshkent",
    // ZXPSignCmd argumenti: bo'sh joysiz.
    org: "AEStudio",
    // Self-signed sertifikat paroli (Q8). Tarqatish uchun ZXP_PASSWORD env bilan almashtiriladi.
    password: process.env.ZXP_PASSWORD ?? "aestudio-dev-cert",
    tsa: ["http://timestamp.digicert.com/", "http://timestamp.apple.com/ts01"],
    allowSkipTSA: true,
    sourceMap: false,
    jsxBin: "off",
  },
  installModules: [],
  // ffmpeg/ffprobe (P5.10): `scripts/bundle-ffmpeg.mjs` `src/bin` ga qo'ygan bo'lsa ZXP'ga kiradi.
  copyAssets: existsSync(fileURLToPath(new URL("./src/bin", import.meta.url))) ? ["bin"] : [],
  copyZipAssets: [],
};

export default config;
