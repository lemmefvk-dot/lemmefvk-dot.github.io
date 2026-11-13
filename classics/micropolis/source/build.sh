#!/usr/bin/env bash
# Builds micropolisJS for StaticOS's Free Classics shelf.
#
#   tools/classics/build-micropolis.sh <work dir> <repo root>
#
# Needs: git, node and npm. No Emscripten: this game is plain JavaScript.
set -euo pipefail

WORK="$1"
ROOT="$2"
COMMIT=f13a1624d111d235e804bd80f48ba7c9f66a8e0f
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/classics/micropolis"
SRC="$WORK/micropolisjs"

mkdir -p "$WORK" "$OUT/source" "$OUT/css" "$OUT/images"
if [ ! -d "$SRC/.git" ]; then
  git clone --quiet https://github.com/graememcc/micropolisJS.git "$SRC"
fi
# upstream's webpack config reads the commit from a branch called main
git -C "$SRC" checkout --quiet -B main "$COMMIT"
git -C "$SRC" clean -qfdx -e node_modules

cd "$SRC"
nice -n 15 npm ci --ignore-scripts --no-audit --no-fund
nice -n 15 npx webpack --mode production

# also writes about.html and name_license.html beside it
node "$HERE/pack-micropolis.mjs" "$SRC/dist" "$OUT/micropolis.html.gz"

# The terms travel with the game: "Any propagation or conveyance of this program
# must include this copyright notice and these terms."
cp dist/LICENSE "$OUT/LICENSE.txt"
cp dist/COPYING "$OUT/COPYING.txt"
cp MicropolisPublicNameLicense.md "$OUT/MicropolisPublicNameLicense.txt"
cp dist/src/micropolis.js.LICENSE.txt "$OUT/jquery-license.txt"
cp css/FONT_LICENSE.markdown "$OUT/css/FONT_LICENSE.txt"
cp dist/css/style.css dist/css/chunk.woff "$OUT/css/"
cp dist/images/dirtbg.png "$OUT/images/"

# The exact source, plus how it was built and packed.
git -C "$SRC" archive --format=tar.gz --prefix="micropolisJS-$COMMIT/" -o "$OUT/source/micropolisJS-$COMMIT.tar.gz" "$COMMIT"
cp "$HERE/pack-micropolis.mjs" "$OUT/source/"
cp "$HERE/build-micropolis.sh" "$OUT/source/build.sh"
ls -l "$OUT" "$OUT/source"
