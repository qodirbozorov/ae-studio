#!/usr/bin/env bash
# macOS relizi (docs/mac-release.md): Apple Silicon + Intel ffmpeg (scripts/build-ffmpeg-mac.sh natijasi) →
# src/bin/darwin-{arm64,x64} → imzolangan ZXP → release/ae-studio-<versiya>-mac.zxp (+ sha256, install-panel.sh).
#   pnpm --filter @aes/panel release:mac
set -euo pipefail
cd "$(dirname "$0")/.."

FF="${AES_FFMPEG_OUT:-$HOME/ffmpeg-lgpl}"
for arch in arm64 x86_64; do
  [ -x "$FF/$arch/bin/ffmpeg" ] || {
    echo "Topilmadi: $FF/$arch/bin/ffmpeg — avval: bash scripts/build-ffmpeg-mac.sh $arch" >&2
    exit 1
  }
done

# Eski darwin binarlari qolib ketmasin; boshqa platformalar papkasiga tegilmaydi.
rm -rf src/bin/darwin-arm64 src/bin/darwin-x64
AES_FFMPEG_DIR="$FF/arm64/bin" AES_FFMPEG_ARCH=arm64 node scripts/bundle-ffmpeg.mjs
AES_FFMPEG_DIR="$FF/x86_64/bin" AES_FFMPEG_ARCH=x64 node scripts/bundle-ffmpeg.mjs

# ZXPSignCmd (vite-cep-plugin) faqat x86_64: Apple Silicon'da Rosetta kerak.
if [ "$(uname -m)" = arm64 ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  echo "Rosetta yo'q: softwareupdate --install-rosetta --agree-to-license" >&2
  exit 1
fi
for sign in ../../node_modules/.pnpm/vite-cep-plugin*/node_modules/vite-cep-plugin/lib/bin/ZXPSignCmd; do
  [ -f "$sign" ] || continue
  chmod +x "$sign"
  xattr -d com.apple.quarantine "$sign" 2>/dev/null || true
done

pnpm run zxp
AES_ZXP_SUFFIX=-mac node scripts/name-zxp.mjs
