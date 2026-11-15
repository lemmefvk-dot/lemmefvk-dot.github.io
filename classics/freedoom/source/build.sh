#!/usr/bin/env bash
# Builds the Doom engine on StaticOS's Free Classics shelf (doomgeneric, a small
# port of Chocolate Doom, GNU GPL 2) and fetches Freedoom: Phase 1, the free game
# data it plays (BSD licence). A player may give it their own DOOM.WAD instead.
#
#   tools/classics/build-doom.sh <work dir> <repo root> [tarball|make|package]
#
# The engine is unmodified: it is built from the published tarball of the exact
# commit, with upstream's own Makefile.emscripten flags, minus its preloaded WAD and its
# MIDI player (see below).
#
# Needs: git, curl, emsdk 4.0.10 activated with EMSDK set.
set -euo pipefail

WORK="$1"
ROOT="$2"
STEP="${3:-all}"
COMMIT=e257a09527062bfb986b6e5e0780839b6cbd5b71
FREEDOOM_ZIP=freedoom-0.13.0.zip
FREEDOOM_URL="https://github.com/freedoom/freedoom/releases/download/v0.13.0/$FREEDOOM_ZIP"
# published in freedoom-0.13.0-CHECKSUM beside the release, signed by the Freedoom project
FREEDOOM_SHA256=3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/classics/freedoom"
CLONE="$WORK/doomgeneric"
NAME="doomgeneric-${COMMIT:0:7}"
TARBALL="$OUT/source/$NAME.tar.gz"
SRC="$WORK/doom-from-tarball/$NAME"

# exactly the objects upstream's Makefile.emscripten links
OBJS="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net f_finale f_wipe
g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system i_timer memio m_argv m_bbox
m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng p_doors p_enemy p_floor p_inter p_lights
p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup p_sight p_spec p_switch p_telept p_tick p_user r_bsp
r_data r_draw r_main r_plane r_segs r_sky r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video
wi_stuff w_checksum w_file w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric doomgeneric_emscripten
mus2mid i_sdlmusic i_sdlsound"

mkdir -p "$OUT/source"

if [ "$STEP" = all ] || [ "$STEP" = tarball ]; then
  if [ ! -d "$CLONE/.git" ]; then git clone --quiet https://github.com/ozkl/doomgeneric.git "$CLONE"; fi
  git -C "$CLONE" checkout --quiet "$COMMIT"
  # the whole repository at that commit: it is small
  git -C "$CLONE" archive --format=tar --prefix="$NAME/" "$COMMIT" | gzip -9 -n > "$TARBALL"
  ls -l "$TARBALL"
fi

if [ "$STEP" = all ] || [ "$STEP" = make ]; then
  rm -rf "$WORK/doom-from-tarball"
  mkdir -p "$WORK/doom-from-tarball"
  tar -xzf "$TARBALL" -C "$WORK/doom-from-tarball"
  cd "$SRC/doomgeneric"
  mkdir -p build
  # FEATURE_SOUND: sound effects through SDL_mixer. Upstream's Makefile also builds
  # SDL_mixer's MIDI player (timidity, under the Artistic Licence), but it needs GUS
  # patches that neither the engine nor Freedoom ships, so it could never play here:
  # SDL_mixer is built with no music formats, and the music stays silent.
  CFLAGS="-O2 -DFEATURE_SOUND -sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sSDL2_MIXER_FORMATS=[]"
  for o in $OBJS; do nice -n 15 emcc $CFLAGS -c "$o.c" -o "build/$o.o"; done
  # no FS mount, no fetch, no preloaded files: the page hands the WAD in (see js/classics/frame.js)
  nice -n 15 emcc $CFLAGS -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=FS -o doom.js build/*.o -lm
  gzip -9 -n -c doom.js > "$OUT/doom.js.gz"
  gzip -9 -n -c doom.wasm > "$OUT/doom.wasm.gz"
  ls -l "$OUT"/doom.*
fi

if [ "$STEP" = all ] || [ "$STEP" = package ]; then
  # Freedoom: Phase 1, from the official zip, only if its checksum matches
  [ -f "$WORK/$FREEDOOM_ZIP" ] || curl -sSL --fail -o "$WORK/$FREEDOOM_ZIP" "$FREEDOOM_URL"
  echo "$FREEDOOM_SHA256  $WORK/$FREEDOOM_ZIP" | shasum -a 256 -c -
  unzip -p "$WORK/$FREEDOOM_ZIP" freedoom-0.13.0/freedoom1.wad | gzip -9 -n > "$OUT/freedoom1.wad.gz"
  # the BSD licence asks for its notice with every copy, and credit to the project
  for f in COPYING.txt CREDITS.txt CREDITS-MUSIC.txt; do unzip -p "$WORK/$FREEDOOM_ZIP" "freedoom-0.13.0/$f" > "$OUT/freedoom-$f"; done
  cp "$SRC/LICENSE" "$OUT/COPYING.txt"
  cp "$HERE/build-doom.sh" "$OUT/source/build.sh"
  ls -l "$OUT" "$OUT/source"
fi
