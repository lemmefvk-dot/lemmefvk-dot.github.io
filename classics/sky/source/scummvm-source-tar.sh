#!/usr/bin/env bash
# Makes the ScummVM source tarball StaticOS hosts: tag v2026.4.0 without what this
# build does not use (every other engine, translations, docs, developer tools, other
# platforms' packaging), so it stays small enough to publish beside the game.
# build-scummvm.sh builds the engine from this tarball, so the two always correspond.
#
#   tools/classics/scummvm-source-tar.sh <scummvm checkout> <out.tar.gz>
set -euo pipefail
SRC="$1"
OUT="$2"
TAG=v2026.4.0

cd "$SRC"
git rev-parse "$TAG^{commit}" >/dev/null 2>&1 || git rev-parse HEAD >/dev/null
KEEP=()
# everything at the top level except the big folders handled below
while IFS= read -r entry; do
  case "$entry" in
    engines|dists|devtools|doc|po|test|icons|.*) ;;
    *) KEEP+=("$entry") ;;
  esac
done < <(git ls-tree --name-only HEAD)
# the engines folder's own files, and this one engine
while IFS= read -r f; do KEEP+=("$f"); done < <(git ls-tree --name-only HEAD engines/ | while read -r e; do
  [ "$(git cat-file -t "HEAD:$e")" = blob ] && echo "$e"
done)
# engines/scumm/configure.engine: engines.awk assumes that engine exists. Without it the
# count is off by one and "sky" silently drops out, and the build still succeeds.
KEEP+=(engines/sky engines/scumm/configure.engine dists/emscripten dists/engine-data/sky.cpt dists/engine-data/README icons/scummvm.xpm)
git archive --format=tar --prefix="scummvm-$TAG-sky-only/" HEAD -- "${KEEP[@]}" | gzip -9 -n > "$OUT"
ls -l "$OUT"
