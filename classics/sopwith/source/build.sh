#!/usr/bin/env bash
# Builds SDL Sopwith for StaticOS's Free Classics shelf.
#
#   tools/classics/build-sopwith.sh <work dir> <repo root>
#
# Needs: git, emsdk 4.0.10 activated (emcc on PATH), and the Emscripten port of
# SDL2, which emcc downloads the first time. No autotools: config.h is written
# here, holding exactly what upstream's configure.ac would define on this target.
set -euo pipefail

WORK="$1"
ROOT="$2"
TAG=sdl-sopwith-2.9.0
COMMIT=d364bc2641043f6dc5f47e8534b2742f3efeaddb
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/classics/sopwith"

mkdir -p "$WORK" "$OUT/source"
SRC="$WORK/sopwith"
if [ ! -d "$SRC/.git" ]; then
  git clone --quiet --depth 1 --branch "$TAG" https://github.com/fragglet/sdl-sopwith.git "$SRC"
fi
[ "$(git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || { echo "sopwith: $TAG is not $COMMIT"; exit 1; }
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" apply "$HERE/patches/sopwith-menu.patch"

cat > "$SRC/src/config.h" <<'EOF'
/* Written by tools/classics/build-sopwith.sh in place of configure's output. */
#define PACKAGE_NAME "SDL Sopwith"
#define PACKAGE_STRING "SDL Sopwith 2.9.0"
#define PACKAGE_VERSION "2.9.0"
#define PACKAGE_TARNAME "sdl-sopwith"
#define VERSION "2.9.0"
#define HAVE_STDBOOL_H 1
#define HAVE_NETINET_IN_H 1
#define HISCORES_PATH ""
EOF

cd "$SRC/src"
# Everything in src/Makefile.am's COMMON_SOURCES and src/sdl/Makefile.am.
SOURCES="swasynio.c swauto.c swcollsn.c swconf.c swend.c swgames.c swgrpha.c swinit.c \
  swmain.c swmenu.c swmove.c swobject.c swsound.c swsplat.c swstbar.c swsymbol.c swtext.c \
  swtitle.c hiscore.c tcpcomm.c touch_area.c video.c yocton.c \
  sdl/video.c sdl/pcsound.c sdl/timer.c sdl/controller.c sdl/main.c"

# Single-threaded on purpose: Surge cannot send COOP/COEP, so no SharedArrayBuffer.
# ASYNCIFY lets the original blocking game loop yield to the browser in Timer_Sleep.
FLAGS="-O2 -sUSE_SDL=2 -fexceptions -sSUPPORT_LONGJMP=emscripten -I. -Isdl"
nice -n 15 emcc $FLAGS $SOURCES -o sopwith.js \
  -flto -sASYNCIFY -sFORCE_FILESYSTEM -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=32MB -sPTHREAD_POOL_SIZE=0 \
  -sEXPORTED_FUNCTIONS=_main -sEXPORTED_RUNTIME_METHODS=FS,ENV \
  -Wl,-u,ntohs

gzip -9 -n -c sopwith.js > "$OUT/sopwith.js.gz"
gzip -9 -n -c sopwith.wasm > "$OUT/sopwith.wasm.gz"

# What a person needs to rebuild exactly this: upstream's tree at this tag with our
# patch applied, this recipe, and the exact compiler version.
git -C "$SRC" checkout --quiet -- .
git -C "$SRC" archive --format=tar.gz --prefix="$TAG/" -o "$OUT/source/$TAG.tar.gz" "$COMMIT"
cp "$HERE/patches/sopwith-menu.patch" "$OUT/source/"
cp "$HERE/build-sopwith.sh" "$OUT/source/build.sh"
cp "$SRC/COPYING.md" "$OUT/COPYING.txt"
cp "$SRC/AUTHORS" "$OUT/AUTHORS.txt"
ls -l "$OUT" "$OUT/source"
