# Blender pipeline: pre-rendered sprites, backdrops and real-time models

Headless Blender scripts (Blender 5.x; tested with 5.2.3 on an Apple M4, Cycles on the Metal GPU + OpenImageDenoise)
that turn one model into the assets for every render tier:

| Script | Makes | For |
|---|---|---|
| `render_sprites.py` | an N-direction × M-frame lit sprite atlas (WebP, optional PNG), a normal-map atlas, a JSON manifest | lite (kit25d `SpriteBatch`) |
| `render_backdrop.py` | stills (1080p + 720p, PNG + WebP), parallax layers with alpha, or a seamless H.264 loop + poster | lite (kit25d `VideoBackdrop`), menus, cut-scenes |
| `export_glb.py` | a plain GLB (no Draco/meshopt/KTX2), textures capped per tier, clear coat, optional baked AO | high / ultra (kit3d `cinematic`) |

`pwtv_common.py` (scene, import, render settings, light presets, material pass) and `pwtv_atlas.py` (cropping,
packing, edge bleeding; numpy only) are shared. Every script runs headless and prints `[pwtv]` lines with timings.

```sh
blender -b --factory-startup -P tools/blender/<script>.py -- <args>     # or: pnpm assets:sprites <args> (etc.)
blender -b --factory-startup -P tools/blender/render_sprites.py -- --help
```

The first Cycles render on a machine compiles the Metal kernels (about 4 minutes, once); later runs start at once.
Without Metal (Linux, CI) Cycles falls back to the CPU, and `--engine eevee` is the fast option.

## Sprites (`render_sprites.py`)

```sh
pnpm assets:sprites --model car.glb --hdri studio_small_08_2k.hdr --preset studio \
  --directions 16 --size 256 --glass --normals --no-png \
  --out apps/web/public/assets/<game>/ --name auto-red --licence "Kenney Car Kit (CC0 1.0)"
```

- **The camera never moves, the model turns**, lit by a fixed rig: an HDRI world plus key (casts the only floor
  shadow), fill and rim area lights, all scaled to the model's size. A shadow-catcher floor bakes a soft contact
  shadow into each cell. AgX view transform, look `AgX - Punchy` by default.
- **Presets** (`--preset`): `studio` (car-advert key/rim), `monsoon` (cool overcast, wet rim), `sunset` (low
  orange key, purple fill). `--finish premium|wet|asis` adds clear coat and glossier paint; `--glass` turns the pale
  sky-blue swatch of palette-textured kits (Kenney) into dark glossy glass.
- **Camera**: `--camera ortho` (default; required for exact pixels-per-metre) or `persp --fov 28`;
  `--elevation 30` (match your game camera's pitch). `--forward -y` is glTF's +Z forward after import.
- **Animation**: `--frames 8 --action Run --fps 12` samples a clip; `--anim-from animations.glb` borrows clips from a
  second file with the same rig (bones bind by name, like KayKit). `--frames > 1` needs a rig.
- **Output**: every cell is cropped to one shared rectangle (union of all frames' pixels), so scale and pivot never
  jump between directions; cells are laid out in the most square grid ≤ `--max-atlas` (4096). Transparent texels
  get their neighbours' colour (no dark fringes under bilinear filtering). `--preview out.png` writes the atlas over
  grey for review: always look at it.
- **Manifest** (`pwtv-sprites` v1): `directions`, `framesPerDirection`, `fps`, `angle0`, `pivot` (ground point as
  cell fractions, top-left origin), `pixelsPerMetre`, `camera`, `frames[]` (atlas rects, index = direction ×
  framesPerDirection + frame). Heading: 0 = facing screen-right, +π/2 = away from the camera, −π/2 = towards it.

Budget for the lite tier: 256 px frames, 16 directions, WebP ≈ 100 KB per vehicle; a fighter with 6 clips × 8
frames × 8 directions at 192 px fits one 4096 atlas.

## Backdrops (`render_backdrop.py`)

```sh
# a 4 s seamless loop, 720p H.264 (CRF 23, Main profile, faststart, no audio) + WebP poster
pnpm assets:backdrop --model car.glb --stage road --hdri kloofendal_overcast_puresky_2k.hdr --preset monsoon \
  --glass --video --seconds 4 --fps 24 --path sway --samples 24 --out <dir> --name ghat-loop
# stills of your own scene (its active camera), 1920×1080 and 1280×720
pnpm assets:backdrop --scene level.blend --still --out <dir> --name title
# parallax layers: collections named sky / far / mid; sky shows the world only, the rest have alpha
pnpm assets:backdrop --scene level.blend --still --layers sky,far,mid --out <dir> --name ghat
```

- `--path sway` (a figure-of-eight drift that returns exactly to the start), `orbit` (one full turn) and `static`
  all loop seamlessly; `--path scene` keeps your .blend's camera animation.
- The built-in `road` stage is a wet asphalt strip with a dashed centre line, wet earth and distance-hazed hills
  (in collections `far` / `mid`), for testing and quick menus. Real levels should be authored as .blend scenes.
- Videos are always one opaque layer (H.264 has no alpha). Rain, sparks and UI go on top in real time.

## Real-time models (`export_glb.py`)

```sh
pnpm assets:glb --model car.glb --tier high  --bake-ao --out apps/web/public/assets/<game>/car-high.glb
pnpm assets:glb --model car.glb --tier ultra --bake-ao --out apps/web/public/assets/<game>/car-ultra.glb
```

Textures are capped at 1024 px (high) / 2048 px (ultra); `--bake-ao` lightmap-packs a second UV set "AO", bakes
Cycles ambient occlusion (512 / 1024 px) and wires it into glTF `occlusionTexture` (`texCoord: 1`), which three.js
loads as `aoMap`. Coat Weight exports as `KHR_materials_clearcoat`. Never enable Draco/meshopt/KTX2: the TV page's
CSP has no `wasm-unsafe-eval`.

## Tested end to end (Apple M4, Blender 5.2.3)

| Asset | Command | Time | Size |
|---|---|---|---|
| Kenney Car Kit `hatchback-sports`, 16 directions, 256 px, 64 samples, + normals | `render_sprites.py` | 42 s (after the one-off kernel compile) | 94 KB WebP + 69 KB normals |
| 4 s 720p loop, road stage, monsoon, 24 samples | `render_backdrop.py --video` | 530 s (96 frames) | 280 KB MP4 + 17 KB poster |
| high GLB + 512 px AO / ultra GLB + 1024 px AO | `export_glb.py` | 83 s / 9 s | 488 KB / 1018 KB |

Outputs are in `apps/web/public/assets/cinematic/showroom/` and shown at `/tv/showroom`.

## Licences

CC0 (Kenney, Quaternius, KayKit, Poly Haven) is preferred. CC-BY is allowed with attribution in `ASSETS.md` and the
game manifest's `licenceInventory`. Never ship logos, brand names or number plates (strip branded textures before
rendering), and no raw Mixamo files. Keep each pack's licence file next to its outputs.
