#!/bin/sh
# Gully Super Over: renders the lite tier's sprite sheets (KayKit kids, CC0) into apps/web/public/assets/gully/sprites.
# Run from the repo root:  sh tools/blender/scenes/gully_sprites.sh [work dir]
# Two teams (orange / blue jerseys) × 7 clips, plus balcony kids cheering. ~40 minutes on an Apple M4 (Cycles).
set -e
WORK=${1:-/tmp/gully-sprites}
OUT=apps/web/public/assets/gully/sprites
ANIMS=apps/web/public/assets/gully/animations.glb
KIDS=apps/web/public/assets/kaykit-adventurers
B="blender -b --factory-startup"
mkdir -p "$WORK" "$OUT"

cast() { # model jersey bat out
  [ -f "$WORK/$4.blend" ] && return 0
  $B -P tools/blender/scenes/gully_cast.py -- --model "$KIDS/$1.glb" --jersey "$2" $3 --out "$WORK/$4.blend"
}
sheet() { # blend name action frames fps trim (skips sheets already rendered)
  [ -f "$OUT/$2.json" ] && return 0
  $B -P tools/blender/render_sprites.py -- --model "$WORK/$1.blend" --anim-from "$ANIMS" --action "$3" \
    --frames "$4" --fps "$5" --trim-start "$6" --directions 8 --size 176 --elevation 10 --samples 14 --preset sunset \
    --no-png --out "$OUT" --name "$2" --licence "KayKit Character Pack Adventurers 1.0 (CC0 1.0)" --preview "$WORK/$2.png"
}

cast mage "#ff8a1f" "" t0
cast mage "#ff8a1f" --bat t0-bat
cast knight "#2fa7ff" "" t1
cast knight "#2fa7ff" --bat t1-bat
cast rogue "#ff4d6d" "" kid

for t in 0 1; do
  sheet t$t t$t-idle Idle 6 8 0
  sheet t$t t$t-run Running_A 8 14 0
  sheet t$t t$t-bowl Throw 10 14 1
  sheet t$t t$t-cheer Cheer 8 10 1
  sheet t$t-bat t$t-bat-stance 2H_Melee_Idle 4 6 0
  sheet t$t-bat t$t-bat-swing 1H_Melee_Attack_Slice_Horizontal 8 14 2
  sheet t$t-bat t$t-bat-run Running_A 8 14 0
done
sheet kid kids-cheer Cheer 8 10 1
cp tools/blender/scenes/LICENSE-kaykit.txt "$OUT/LICENSE-kaykit.txt" 2>/dev/null || cp "$KIDS/LICENSE.txt" "$OUT/LICENSE-kaykit.txt"
