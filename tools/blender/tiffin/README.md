# Tiffin Tornado assets (Blender 5, headless)

Game-specific scripts on top of `tools/blender/` (`pwtv_common.py`, `pwtv_atlas.py`). Everything ships to
`apps/web/public/assets/tiffin/`. Sources (all CC0, downloaded to a scratch folder, not committed):
KayKit Restaurant Bits 1.0 and Character Pack Adventurers 1.0 (github.com/KayKit-Game-Assets), Poly Haven HDRIs
`kloofendal_48d_partly_cloudy_puresky_2k.hdr` and `studio_small_09_2k.hdr`.

| Script | Makes |
|---|---|
| `build_level.py` | the kitchen carriage for a level from its layout: lite backdrops (`kitchen-<n>-day/shut/dark.webp`, Cycles, transparent outside and through the windows), `kitchen-<n>.json` (the camera the game must use) and `kitchen-<n>.glb` (high/ultra) |
| `render_food.py` | `food.webp/.json` (one sprite per dish/ingredient/cooking state, `names` lists them) and `food.glb` |
| `render_chefs.py` | `chef-<n>.webp/.json` (8 directions × idle, run, carry, carry-run, work, cheer in one atlas, `clips` in the manifest, aprons in key magenta for the player tint) and `chef-<n>.glb` |
| `render_scenery.py` | tileable window scenery: `scenery-far` (sky, hills), `-fields`, `-platform`, `-tunnel` (side views), `-track` (the rails under the train, game camera) |
| `tt_common.py`, `tt_food.py`, `tt_stations.py`, `tt_carriage.py`, `tt_chef.py`, `tt_light.py` | modelling in code, the KayKit repaint, the shared camera (orthographic, 45° pitch) and light |

```sh
# layouts from the game (Node strips the TypeScript types)
node -e "import('./apps/web/src/games/tiffin/levels.ts').then(m=>require('fs').writeFileSync('levels.json', JSON.stringify(m.LEVELS.map(l=>({id:l.id,layout:l.layout})))))"
O=apps/web/public/assets/tiffin
blender -b --factory-startup -P tools/blender/tiffin/render_food.py -- --hdri studio_small_09_2k.hdr --out $O
blender -b --factory-startup -P tools/blender/tiffin/build_level.py -- --levels levels.json --level 1 --kit <Restaurant Bits>/Assets/gltf \
  --hdri kloofendal_48d_partly_cloudy_puresky_2k.hdr --out $O --still --glb --samples 64        # levels 1, 2, 3
blender -b --factory-startup -P tools/blender/tiffin/render_chefs.py -- --model <Adventurers>/Characters/gltf/Knight.glb --base Knight \
  --name chef-1 --hdri studio_small_09_2k.hdr --out $O --glb                                    # Barbarian, Mage, Rogue → chef-2..4
blender -b --factory-startup -P tools/blender/tiffin/render_scenery.py -- --kind fields --hdri kloofendal_48d_partly_cloudy_puresky_2k.hdr --out $O
```

Changing a layout in `levels.ts` means re-running `build_level.py` for that level (the backdrop must match the
grid exactly). Keep the camera pitch (`tt_light.PITCH`) identical for kitchens, chefs and food.
