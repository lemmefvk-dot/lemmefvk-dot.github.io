#!/usr/bin/env bash
# Builds the two further ScummVM engines on StaticOS's Free Classics shelf, and
# fetches the three freeware games that need them:
#
#   free  queen, lure and drascula: Flight of the Amazon Queen, Lure of the
#         Temptress and Drascula, three games their makers released as freeware
#   own   the adventure engines a player's own old games need ("Your own
#         ScummVM games"): LucasArts, Sierra, Revolution, Westwood and more
#
#   tools/classics/build-scummvm-more.sh <work dir> <repo root> [tarball|free|own|package]
#
# Both are built from the one source tarball StaticOS publishes beside them
# (classics/scummvm/source/), unpacked somewhere clean and patched with the same
# sandbox patch as Beneath a Steel Sky's engine, so what we ship and the source
# we offer correspond. Beneath a Steel Sky keeps its own engine (build-scummvm.sh).
#
# Needs: git, python3, curl, emsdk 4.0.10 activated with EMSDK set.
set -euo pipefail

WORK="$1"
ROOT="$2"
STEP="${3:-all}"
TAG=v2026.4.0
COMMIT=7d2709da5136866589f7602f5f5a7b17de03420e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/classics/scummvm"
CLONE="$WORK/scummvm"
NAME="scummvm-$TAG-classics"
TARBALL="$OUT/source/$NAME.tar.gz"
JOBS="${JOBS:-4}"

FREE_ENGINES="queen,lure,drascula"
# The player's own games. Adventure engines only, with their sub-engines: no
# RPGs (lol, eob) and nothing that needs a video library we leave out.
OWN_ENGINES="scumm,scumm_7_8,he,agi,sci,sci32,agos,agos2,kyra,sword1,sword2,queen,sky,lure,drascula,saga,ihnm,tinsel,gob,cine,cruise,touche,tucker,dreamweb,made,parallaction,toon"
# the folders those come from (sub-engines live in their parent's folder)
DIRS="scumm agi sci agos kyra sword1 sword2 queen sky lure drascula saga tinsel gob cine cruise touche tucker dreamweb made parallaction toon"
# engine data files the games above need, from dists/engine-data
DATA="queen.tbl lure.dat drascula.dat sky.cpt kyra.dat toon.dat"

mkdir -p "$WORK/bin" "$OUT/source" "$OUT/LICENSES" "$OUT/data"

if ! command -v pkg-config >/dev/null; then
  install -m 755 "$HERE/pkg-config-shim.py" "$WORK/bin/pkg-config"
  export PATH="$WORK/bin:$PATH"
fi

unpack() {   # unpack <dir>: a clean, patched tree from the published tarball
  rm -rf "$1"
  mkdir -p "$1"
  tar -xzf "$TARBALL" -C "$1"
  patch -d "$1/$NAME" -p1 --quiet < "$HERE/patches/scummvm-sandbox.patch"
}

if [ "$STEP" = all ] || [ "$STEP" = tarball ]; then
  if [ ! -d "$CLONE/.git" ]; then
    git clone --quiet --depth 1 --branch "$TAG" https://github.com/scummvm/scummvm.git "$CLONE"
  fi
  [ "$(git -C "$CLONE" rev-parse HEAD)" = "$COMMIT" ] || { echo "scummvm: $TAG is not $COMMIT"; exit 1; }
  # the tag without what neither build uses: every other engine, translations,
  # docs, developer tools and other platforms' packaging
  KEEP=()
  while IFS= read -r entry; do
    case "$entry" in
      engines|dists|devtools|doc|po|test|icons|.*) ;;
      *) KEEP+=("$entry") ;;
    esac
  done < <(git -C "$CLONE" ls-tree --name-only HEAD)
  while IFS= read -r e; do
    [ "$(git -C "$CLONE" cat-file -t "HEAD:$e")" = blob ] && KEEP+=("$e")
  done < <(git -C "$CLONE" ls-tree --name-only HEAD engines/)
  for d in $DIRS; do KEEP+=("engines/$d"); done
  for f in $DATA; do KEEP+=("dists/engine-data/$f"); done
  KEEP+=(dists/emscripten dists/engine-data/README icons/scummvm.xpm)
  git -C "$CLONE" archive --format=tar --prefix="$NAME/" HEAD -- "${KEEP[@]}" | gzip -9 -n > "$TARBALL"
  ls -l "$TARBALL"
fi

build() {   # build <free|own> <engines> <extra configure flags…>
  local which="$1" engines="$2"
  shift 2
  local dir="$WORK/scummvm-$which"
  unpack "$dir"
  cd "$dir/$NAME"
  nice -n 15 emconfigure ./configure \
    --host=wasm32-unknown-emscripten --build=wasm32-unknown-emscripten \
    --disable-all-engines --enable-engine="$engines" \
    --enable-release --disable-debug --disable-detection-full \
    --opengl-mode=none --disable-tinygl --disable-opengl-game \
    --disable-cloud --disable-dlc --disable-scummvmdlc --disable-libcurl --disable-sdlnet --disable-enet \
    --disable-tts --disable-taskbar --disable-system-dialogs --disable-updates --disable-discord \
    --disable-translation --disable-imgui --disable-hq-scalers --disable-edge-scalers \
    --disable-mt32emu --disable-fluidsynth --disable-fluidlite --disable-sonivox --disable-timidity \
    --disable-tremor --disable-mad --disable-a52 \
    --disable-mpeg2 --disable-mpcdec --disable-faad --disable-theoradec --disable-vpx \
    --disable-jpeg --disable-png --disable-gif --disable-freetype2 --disable-fribidi \
    --disable-mikmod --disable-openmpt --disable-retrowave --disable-opl2lpt "$@"
  # a build that dropped an engine still links: check every one made it in
  # (an engine is "= STATIC_PLUGIN" in config.mk, a sub-engine "= 1")
  for e in ${engines//,/ }; do
    grep -Eq "^ENABLE_$(echo "$e" | tr '[:lower:]' '[:upper:]') = (STATIC_PLUGIN|1)$" config.mk \
      || { echo "scummvm-$which: $e is not in the build"; exit 1; }
  done
  nice -n 15 emmake make -j"$JOBS" scummvm.html
  gzip -9 -n -c scummvm.js > "$OUT/scummvm-$which.js.gz"
  gzip -9 -n -c scummvm.wasm > "$OUT/scummvm-$which.wasm.gz"
  ls -l "$OUT/scummvm-$which".*
}

if [ "$STEP" = all ] || [ "$STEP" = free ]; then
  # the three freeware games: floppy versions, AdLib music, no speech, no video
  build free "$FREE_ENGINES" --disable-ogg --disable-vorbis --disable-flac --disable-zlib --disable-bink
fi

if [ "$STEP" = all ] || [ "$STEP" = own ]; then
  # a player's own games: CD versions often ship Ogg Vorbis audio (ScummVM's own
  # compressed versions) and zlib-compressed data. Both come from Emscripten's ports.
  build own "$OWN_ENGINES" --enable-zlib --enable-ogg --enable-vorbis --disable-flac
fi

if [ "$STEP" = all ] || [ "$STEP" = package ]; then
  SRC="$WORK/scummvm-free/$NAME"
  for f in $DATA; do gzip -9 -n -c "$SRC/dists/engine-data/$f" > "$OUT/data/$f.gz"; done

  # the games: the official zips, byte for byte, only if each checksum matches
  # what scummvm.org publishes. Their licences require the readme to stay with
  # them, and keeping each zip whole does that; the licence is also copied out
  # so the card can link to it.
  get() {   # get <folder> <url> <sha256> <licence member> <as>
    local dir="$ROOT/classics/$1" file
    file="$dir/$(basename "${2//%20/ }")"
    mkdir -p "$dir"
    [ -f "$file" ] || curl -sSL --fail -o "$file" "$2"
    echo "$3  $file" | shasum -a 256 -c -
    unzip -p "$file" "$4" > "$dir/$5"
  }
  get queen "https://downloads.scummvm.org/frs/extras/Flight%20of%20the%20Amazon%20Queen/FOTAQ_Floppy.zip" \
    2e59de85f708cdb32bf85c85b394ac091c05f7647e856b71f5b3ae73fde761e0 FOTAQ_Floppy/readme.txt readme.txt
  get lure "https://downloads.scummvm.org/frs/extras/Lure%20of%20the%20Temptress/lure-1.1.zip" \
    f3178245a1483da1168c3a11e70b65d33c389f1f5df63d4f3a356886c1890108 lure/LICENSE.txt LICENSE.txt
  get drascula "https://downloads.scummvm.org/frs/extras/Drascula_%20The%20Vampire%20Strikes%20Back/drascula-1.0.zip" \
    b731f6cb5a22ba8b4c3b3362f570b9a10a67b6cb0b395394b19a94b36e4e42de readme.txt readme.txt

  # .txt so a browser shows them rather than downloading them
  cp "$SRC/COPYING" "$OUT/COPYING.txt"
  cp "$SRC/COPYRIGHT" "$OUT/COPYRIGHT.txt"
  for f in "$SRC"/LICENSES/*; do cp "$f" "$OUT/LICENSES/$(basename "$f").txt"; done
  cp "$HERE/patches/scummvm-sandbox.patch" "$OUT/source/"
  cp "$HERE/pkg-config-shim.py" "$OUT/source/"
  cp "$HERE/build-scummvm-more.sh" "$OUT/source/build.sh"
  ls -l "$OUT" "$OUT/source" "$OUT/data"
fi
