#!/usr/bin/env bash
# AE Studio panelini o'rnatadi (macOS, P5.11).
# 1) Adobe UnifiedPluginInstallerAgent bo'lsa: --install <zxp>; 2) bo'lmasa (yoki --manual): ZXP foydalanuvchi
# CEP extensions papkasiga ochiladi. ZXP imzolangan (self-signed) — PlayerDebugMode shart emas.
#   ./install-panel.sh [ae-studio-X.Y.Z.zxp] [--manual]
set -euo pipefail

ID="com.aestudio.panel"
ZXP=""
MANUAL=0
EXT_DIR="${AES_EXTENSIONS_DIR:-$HOME/Library/Application Support/Adobe/CEP/extensions}"
for arg in "$@"; do
  case "$arg" in
    --manual) MANUAL=1 ;;
    *) ZXP="$arg" ;;
  esac
done
if [ -z "$ZXP" ]; then
  ZXP="$(ls -t "$(dirname "$0")"/ae-studio-*.zxp 2>/dev/null | head -n 1 || true)"
fi
[ -n "$ZXP" ] && [ -f "$ZXP" ] || { echo "ZXP topilmadi: fayl yo'lini bering" >&2; exit 1; }
echo "AE Studio: $ZXP"

UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
if [ "$MANUAL" = 0 ] && [ -x "$UPIA" ]; then
  echo "UnifiedPluginInstallerAgent bilan o'rnatilmoqda..."
  if "$UPIA" --install "$ZXP"; then
    echo "Tayyor. After Effects'ni qayta oching: Window > Extensions > AE Studio"
    exit 0
  fi
  echo "UPIA xato qaytardi: qo'lda o'rnatishga o'tiladi" >&2
fi

TARGET="$EXT_DIR/$ID"
if [ -d "$TARGET" ]; then
  # Zaxira extensions papkasidan TASHQARIDA: aks holda CEP bir xil ID'li eski nusxani yuklashi mumkin.
  BACKUPS="$(dirname "$EXT_DIR")/aestudio-backups"
  mkdir -p "$BACKUPS"
  BACKUP="$BACKUPS/$(basename "$TARGET").old-$(date +%Y%m%d%H%M%S)"
  mv "$TARGET" "$BACKUP"
  echo "Eski versiya saqlandi: $BACKUP"
fi
mkdir -p "$TARGET"
unzip -q -o "$ZXP" -d "$TARGET"
[ -f "$TARGET/CSXS/manifest.xml" ] || { echo "manifest.xml topilmadi: ZXP buzilgan" >&2; exit 1; }
# ZXP ichidagi ffmpeg bajariladigan bo'lsin.
chmod +x "$TARGET"/bin/*/ffmpeg "$TARGET"/bin/*/ffprobe 2>/dev/null || true
echo "O'rnatildi: $TARGET"
echo "After Effects'ni qayta oching: Window > Extensions > AE Studio"
