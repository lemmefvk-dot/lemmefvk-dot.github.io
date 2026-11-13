#!/usr/bin/env bash
# Builds ScummVM with only the Beneath a Steel Sky engine, for StaticOS's Free
# Classics shelf, and fetches the game's official freeware data.
#
#   tools/classics/build-scummvm.sh <work dir> <repo root> [source|configure|make|package]
#
# The engine is built from the same source tarball StaticOS publishes, unpacked
# somewhere clean and patched, so what we ship and the source we offer correspond.
#
# Needs: git, python3, emsdk 4.0.10 activated (the version ScummVM's own
# dists/emscripten/build.sh pins for this tag) with EMSDK set.
set -euo pipefail

WORK="$1"
ROOT="$2"
STEP="${3:-all}"
TAG=v2026.4.0
COMMIT=7d2709da5136866589f7602f5f5a7b17de03420e
GAME_ZIP=BASS-Floppy-1.3.zip
GAME_URL="https://downloads.scummvm.org/frs/extras/Beneath%20a%20Steel%20Sky/BASS-Floppy-1.3.zip"
GAME_SHA256=d0bac1bd61747a67e885fa44b78c78887bf2b15d3dfa2790c483fad651078818
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/classics/sky"
CLONE="$WORK/scummvm"
TARBALL="$OUT/source/scummvm-$TAG-sky-only.tar.gz"
SRC="$WORK/scummvm-from-tarball/scummvm-$TAG-sky-only"

mkdir -p "$WORK/bin" "$OUT/source" "$OUT/LICENSES"

# configure runs `pkg-config sdl3`; use the system's if there is one
if ! command -v pkg-config >/dev/null; then
  install -m 755 "$HERE/pkg-config-shim.py" "$WORK/bin/pkg-config"
  export PATH="$WORK/bin:$PATH"
fi

if [ "$STEP" = all ] || [ "$STEP" = source ]; then
  if [ ! -d "$CLONE/.git" ]; then
    git clone --quiet --depth 1 --branch "$TAG" https://github.com/scummvm/scummvm.git "$CLONE"
  fi
  [ "$(git -C "$CLONE" rev-parse HEAD)" = "$COMMIT" ] || { echo "scummvm: $TAG is not $COMMIT"; exit 1; }
  bash "$HERE/scummvm-source-tar.sh" "$CLONE" "$TARBALL"
  rm -rf "$WORK/scummvm-from-tarball"
  mkdir -p "$WORK/scummvm-from-tarball"
  tar -xzf "$TARBALL" -C "$WORK/scummvm-from-tarball"
  patch -d "$SRC" -p1 --quiet < "$HERE/patches/scummvm-sandbox.patch"
fi

if [ "$STEP" = all ] || [ "$STEP" = configure ]; then
  cd "$SRC"
  # --disable-all-engines --enable-engine=sky: this game only. Everything else off
  # keeps the download small; none of it is used by the floppy version, whose music
  # is AdLib (OPL emulation, built in) and which has no speech or video.
  nice -n 15 emconfigure ./configure \
    --host=wasm32-unknown-emscripten --build=wasm32-unknown-emscripten \
    --disable-all-engines --enable-engine=sky \
    --enable-release --disable-debug --disable-detection-full \
    --opengl-mode=none --disable-tinygl --disable-opengl-game \
    --disable-cloud --disable-dlc --disable-scummvmdlc --disable-libcurl --disable-sdlnet --disable-enet \
    --disable-tts --disable-taskbar --disable-system-dialogs --disable-updates --disable-discord \
    --disable-translation --disable-imgui --disable-bink --disable-hq-scalers --disable-edge-scalers \
    --disable-mt32emu --disable-fluidsynth --disable-fluidlite --disable-sonivox --disable-timidity \
    --disable-ogg --disable-vorbis --disable-tremor --disable-flac --disable-mad --disable-a52 \
    --disable-mpeg2 --disable-mpcdec --disable-faad --disable-theoradec --disable-vpx \
    --disable-jpeg --disable-png --disable-gif --disable-freetype2 --disable-fribidi \
    --disable-mikmod --disable-openmpt --disable-retrowave --disable-opl2lpt
  # a build without this line has no game in it, and still links: see scummvm-source-tar.sh
  grep -q 'MODULES += engines/sky' engines/engines.mk || { echo "scummvm: the sky engine is not in the build"; exit 1; }
fi

if [ "$STEP" = all ] || [ "$STEP" = make ]; then
  cd "$SRC"
  # -j2: other work is usually going on on this machine
  nice -n 15 emmake make -j2 scummvm.html
fi

if [ "$STEP" = all ] || [ "$STEP" = package ]; then
  cd "$SRC"
  gzip -9 -n -c scummvm.js > "$OUT/scummvm.js.gz"
  gzip -9 -n -c scummvm.wasm > "$OUT/scummvm.wasm.gz"
  # sky.cpt: the game's tables, part of ScummVM's own tree (dists/engine-data)
  gzip -9 -n -c dists/engine-data/sky.cpt > "$OUT/sky.cpt.gz"

  # The game data: the official zip, byte for byte, only if its checksum matches
  # what scummvm.org publishes. Its licence requires the readme to stay with it,
  # and keeping the zip whole does that for us. The readme is also copied out so
  # the game's card can link to it.
  if [ ! -f "$OUT/$GAME_ZIP" ]; then
    curl -sSL --fail -o "$OUT/$GAME_ZIP" "$GAME_URL"
  fi
  echo "$GAME_SHA256  $OUT/$GAME_ZIP" | shasum -a 256 -c -
  unzip -p "$OUT/$GAME_ZIP" readme.txt > "$OUT/readme.txt"

  # .txt so a browser shows them rather than downloading them
  cp COPYING "$OUT/COPYING.txt"
  cp COPYRIGHT "$OUT/COPYRIGHT.txt"
  # the licences of the parts of ScummVM that are not GPL, which COPYRIGHT points to
  for f in LICENSES/*; do cp "$f" "$OUT/LICENSES/$(basename "$f").txt"; done
  cp "$HERE/patches/scummvm-sandbox.patch" "$OUT/source/"
  cp "$HERE/scummvm-source-tar.sh" "$OUT/source/"
  cp "$HERE/pkg-config-shim.py" "$OUT/source/"
  cp "$HERE/build-scummvm.sh" "$OUT/source/build.sh"
  ls -l "$OUT" "$OUT/source"
fi
