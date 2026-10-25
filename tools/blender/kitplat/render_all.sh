#!/bin/sh
# Renders every kitplat asset (heroes, foes, items, tiles, backdrops) into apps/web/public/assets/plat/.
#   sh tools/blender/kitplat/render_all.sh [what] [preview-dir]
# what: all (default) | heroes | foes | items | tiles | backdrops | <one hero, e.g. keeri>
set -e
cd "$(dirname "$0")/../../.."
B=${BLENDER:-/opt/homebrew/bin/blender}
OUT=apps/web/public/assets/plat
PREV=${2:--}
WHAT=${1:-all}
run() { "$B" -b --factory-startup -P "tools/blender/kitplat/$1" -- "$@" 2>&1 | grep -E "^\[kitplat|Error|Traceback|line [0-9]" || true; }
pv() { if [ "$PREV" = "-" ]; then echo -; else echo "$PREV/$1.png"; fi; }

for h in keeri diya asha; do
  if [ "$WHAT" = all ] || [ "$WHAT" = heroes ] || [ "$WHAT" = "$h" ]; then
    "$B" -b --factory-startup -P tools/blender/kitplat/plat_heroes.py -- "$h" "$OUT/$h" "$(pv "$h")" 2>&1 | grep -E "^\[kitplat|Error|Traceback" || true
  fi
done
for w in monsoon festival stepwell; do
  if [ "$WHAT" = all ] || [ "$WHAT" = foes ] || [ "$WHAT" = "foes-$w" ]; then
    "$B" -b --factory-startup -P tools/blender/kitplat/plat_foes.py -- "$w" "$OUT/$w" "$(pv "foes-$w")" 2>&1 | grep -E "^\[kitplat|Error|Traceback" || true
  fi
  if [ "$WHAT" = all ] || [ "$WHAT" = items ] || [ "$WHAT" = "items-$w" ]; then
    "$B" -b --factory-startup -P tools/blender/kitplat/plat_items.py -- "$w" "$OUT/$w" "$(pv "items-$w")" 2>&1 | grep -E "^\[kitplat|Error|Traceback" || true
  fi
  if [ "$WHAT" = all ] || [ "$WHAT" = tiles ] || [ "$WHAT" = "tiles-$w" ]; then
    "$B" -b --factory-startup -P tools/blender/kitplat/plat_tiles.py -- "$w" "$OUT/$w" "$(pv "tiles-$w")" 2>&1 | grep -E "^\[kitplat|Error|Traceback" || true
  fi
  if [ "$WHAT" = all ] || [ "$WHAT" = backdrops ] || [ "$WHAT" = "backdrop-$w" ]; then
    "$B" -b --factory-startup -P tools/blender/kitplat/plat_backdrop.py -- "$w" "$OUT/$w" "$(pv "backdrop-$w")" 2>&1 | grep -E "^\[kitplat|Error|Traceback" || true
  fi
done
