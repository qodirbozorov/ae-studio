#!/usr/bin/env bash
# macOS uchun LGPL static ffmpeg/ffprobe (P5.10, Q9): Windows'dagi BtbN LGPL build bilan bir xil imkoniyatlar —
# libopus (audio.extract opus), libmp3lame (mp3), libfreetype + libharfbuzz (contact sheet drawtext),
# libdav1d (AV1 manbalar), VideoToolbox (h264_videotoolbox), AudioToolbox. Hamma kutubxona static,
# faqat macOS tizim kutubxonalari/frameworklariga bog'lanadi (Homebrew dylib'lari kirmaydi).
#
#   bash apps/panel/scripts/build-ffmpeg-mac.sh arm64     # Apple Silicon
#   bash apps/panel/scripts/build-ffmpeg-mac.sh x86_64    # Intel (Apple Silicon'da ham kross-yig'iladi)
#
# Natija: ~/ffmpeg-lgpl/<arch>/bin/{ffmpeg,ffprobe,THIRD_PARTY_LICENSES.txt}.
# Talablar: Xcode CLT, `brew install nasm pkg-config meson ninja` (faqat yig'ish asboblari).
set -euo pipefail

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
  arm64) CPU_FAMILY=aarch64 ;;
  x86_64) CPU_FAMILY=x86_64 ;;
  *) echo "Arxitektura: arm64 yoki x86_64" >&2; exit 1 ;;
esac

FFMPEG_VERSION=8.1.3
OPUS_VERSION=1.5.2
LAME_VERSION=3.100
FREETYPE_VERSION=2.14.3
HARFBUZZ_VERSION=14.6.0
DAV1D_VERSION=1.5.4
MIN_MACOS=12.0

ROOT="${AES_FFMPEG_BUILD:-$HOME/build/ffmpeg-mac}"
SRC="$ROOT/src"
WORK="$ROOT/$ARCH"
PREFIX="$WORK/deps"
OUT="${AES_FFMPEG_OUT:-$HOME/ffmpeg-lgpl}/$ARCH"
JOBS="$(sysctl -n hw.ncpu)"

for tool in clang nasm pkg-config meson ninja curl; do
  command -v "$tool" >/dev/null || { echo "Topilmadi: $tool (brew install nasm pkg-config meson ninja)" >&2; exit 1; }
done

export MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS"
export CC="clang -arch $ARCH"
export CXX="clang++ -arch $ARCH"
export CFLAGS="-O2 -mmacosx-version-min=$MIN_MACOS"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-mmacosx-version-min=$MIN_MACOS"
# Faqat o'zimiz yig'gan kutubxonalar: Homebrew'dagi .pc fayllar ko'rinmasin.
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
unset PKG_CONFIG_PATH

HOST_ARCH="$(uname -m)"
AUTOCONF_HOST=()
MESON_CROSS=()
if [ "$ARCH" != "$HOST_ARCH" ]; then
  AUTOCONF_HOST=(--host="$ARCH-apple-darwin")
  mkdir -p "$WORK"
  cat >"$WORK/cross.ini" <<EOF
[binaries]
c = ['clang', '-arch', '$ARCH']
cpp = ['clang++', '-arch', '$ARCH']
objc = ['clang', '-arch', '$ARCH']
ar = 'ar'
strip = 'strip'
pkg-config = 'pkg-config'
nasm = 'nasm'

[host_machine]
system = 'darwin'
cpu_family = '$CPU_FAMILY'
cpu = '$ARCH'
endian = 'little'
EOF
  MESON_CROSS=(--cross-file "$WORK/cross.ini")
fi

fetch() {
  local url="$1" file="$SRC/$(basename "$1")"
  mkdir -p "$SRC"
  if [ ! -s "$file" ]; then
    curl -fsSL --retry 3 -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
}

# Manbani har arxitektura uchun toza ochadi.
unpack() {
  local file="$SRC/$1" dir="$WORK/build/$2"
  rm -rf "$dir"
  mkdir -p "$WORK/build"
  tar xf "$file" -C "$WORK/build"
  echo "$dir"
}

meson_build() {
  local dir="$1"
  shift
  (cd "$dir" && meson setup _build ${MESON_CROSS[@]+"${MESON_CROSS[@]}"} --prefix="$PREFIX" --libdir=lib \
    --buildtype=release --default-library=static --wrap-mode=nofallback "$@" &&
    ninja -C _build -j "$JOBS" && ninja -C _build install)
}

fetch "https://github.com/xiph/opus/releases/download/v$OPUS_VERSION/opus-$OPUS_VERSION.tar.gz"
fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz"
fetch "https://download.savannah.gnu.org/releases/freetype/freetype-$FREETYPE_VERSION.tar.xz"
fetch "https://github.com/harfbuzz/harfbuzz/releases/download/$HARFBUZZ_VERSION/harfbuzz-$HARFBUZZ_VERSION.tar.xz"
fetch "https://downloads.videolan.org/pub/videolan/dav1d/$DAV1D_VERSION/dav1d-$DAV1D_VERSION.tar.xz"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"

rm -rf "$PREFIX"
mkdir -p "$PREFIX"

echo "== opus $OPUS_VERSION ($ARCH)"
d=$(unpack "opus-$OPUS_VERSION.tar.gz" "opus-$OPUS_VERSION")
(cd "$d" && ./configure ${AUTOCONF_HOST[@]+"${AUTOCONF_HOST[@]}"} --prefix="$PREFIX" --enable-static --disable-shared \
  --disable-doc --disable-extra-programs && make -j"$JOBS" && make install)

echo "== lame $LAME_VERSION ($ARCH)"
d=$(unpack "lame-$LAME_VERSION.tar.gz" "lame-$LAME_VERSION")
(cd "$d" && ./configure ${AUTOCONF_HOST[@]+"${AUTOCONF_HOST[@]}"} --prefix="$PREFIX" --enable-static --disable-shared \
  --disable-frontend --disable-decoder --disable-gtktest && make -j"$JOBS" && make install)

echo "== freetype $FREETYPE_VERSION ($ARCH)"
d=$(unpack "freetype-$FREETYPE_VERSION.tar.xz" "freetype-$FREETYPE_VERSION")
meson_build "$d" -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled -Dpng=disabled \
  -Dzlib=disabled -Dtests=disabled

echo "== harfbuzz $HARFBUZZ_VERSION ($ARCH)"
d=$(unpack "harfbuzz-$HARFBUZZ_VERSION.tar.xz" "harfbuzz-$HARFBUZZ_VERSION")
meson_build "$d" -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
  -Dchafa=disabled -Dicu=disabled -Dgraphite2=disabled -Dcoretext=disabled -Dtests=disabled \
  -Dintrospection=disabled -Ddocs=disabled -Dutilities=disabled -Dbenchmark=disabled

echo "== dav1d $DAV1D_VERSION ($ARCH)"
d=$(unpack "dav1d-$DAV1D_VERSION.tar.xz" "dav1d-$DAV1D_VERSION")
meson_build "$d" -Denable_tools=false -Denable_tests=false -Denable_examples=false

echo "== ffmpeg $FFMPEG_VERSION ($ARCH)"
d=$(unpack "ffmpeg-$FFMPEG_VERSION.tar.xz" "ffmpeg-$FFMPEG_VERSION")
CROSS=()
[ "$ARCH" != "$HOST_ARCH" ] && CROSS=(--enable-cross-compile --target-os=darwin)
rm -rf "$OUT"
(cd "$d" && ./configure \
  --prefix="$OUT" \
  --arch="$ARCH" ${CROSS[@]+"${CROSS[@]}"} \
  --cc="clang -arch $ARCH" --cxx="clang++ -arch $ARCH" \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include -mmacosx-version-min=$MIN_MACOS" \
  --extra-ldflags="-L$PREFIX/lib -mmacosx-version-min=$MIN_MACOS" \
  --extra-libs="-lc++ -liconv" \
  --disable-gpl --disable-nonfree --disable-version3 \
  --enable-static --disable-shared \
  --disable-autodetect \
  --enable-zlib --enable-bzlib --enable-iconv \
  --enable-videotoolbox --enable-audiotoolbox \
  --enable-libopus --enable-libmp3lame --enable-libfreetype --enable-libharfbuzz --enable-libdav1d \
  --disable-doc --disable-debug --disable-ffplay &&
  make -j"$JOBS" && make install)

# Litsenziyalar (BSD/MIT/FTL bildirishnomalari binar bilan birga tarqatilishi shart).
{
  echo "AE Studio — macOS ffmpeg $FFMPEG_VERSION ($ARCH), LGPL v2.1+ build. Statik kutubxonalar:"
  echo
  for entry in \
    "Opus $OPUS_VERSION (BSD-3-Clause)|opus-$OPUS_VERSION/COPYING" \
    "LAME $LAME_VERSION (LGPL-2.0+)|lame-$LAME_VERSION/COPYING" \
    "FreeType $FREETYPE_VERSION (FreeType License). Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.|freetype-$FREETYPE_VERSION/docs/FTL.TXT" \
    "HarfBuzz $HARFBUZZ_VERSION (MIT)|harfbuzz-$HARFBUZZ_VERSION/COPYING" \
    "dav1d $DAV1D_VERSION (BSD-2-Clause)|dav1d-$DAV1D_VERSION/COPYING"; do
    echo "================================================================"
    echo "${entry%%|*}"
    echo "================================================================"
    cat "$WORK/build/${entry#*|}"
    echo
  done
} >"$OUT/bin/THIRD_PARTY_LICENSES.txt"

echo
echo "Tayyor: $OUT/bin"
"$OUT/bin/ffmpeg" -version 2>/dev/null | head -1 || echo "(boshqa arxitektura — bu Mac'da ishga tushirilmadi)"
otool -L "$OUT/bin/ffmpeg" | tail -n +2
