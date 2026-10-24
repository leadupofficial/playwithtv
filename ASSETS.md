# Third-party assets and content licences

Everything not listed here is original to this repository (drawn or synthesised in code). Add a section when you
add an asset, and keep the licence file next to it.

## Emoji Dhamaka and the trivia question packs

### Question packs (`content/trivia/`)
- Our own questions, emoji encodings, prompts and translations: **CC BY 4.0**, author "Play With TV contributors".
- Questions marked `source: "wikidata:Q…"` take their facts (release year, director, music director) from
  [Wikidata](https://www.wikidata.org/), which is **CC0**; those questions are released as CC0 too.
- Film and song **titles** are used as facts only: no posters, stills, audio, lyrics, melodies, photos of real
  people or studio logos are used anywhere.

### Fonts (`apps/web/public/fonts/`), SIL Open Font License 1.1
| Font | Files | Source | Licence file |
|---|---|---|---|
| Noto Sans Tamil (400, 700, Tamil subset) | `noto-sans-tamil-tamil-*.woff2` | Noto Project, via the `@fontsource/noto-sans-tamil` 5.3.0 package | `OFL-NotoSansTamil.txt` |
| Noto Sans Devanagari (400, 700, Devanagari subset) | `noto-sans-devanagari-devanagari-*.woff2` | Noto Project, via `@fontsource/noto-sans-devanagari` 5.3.0 | `OFL-NotoSansDevanagari.txt` |
| Baloo 2 (800, Latin and Devanagari subsets) | `baloo-2-*-800-normal.woff2` | EkType, via `@fontsource/baloo-2` 5.3.0 | `OFL-Baloo2.txt` |
| Baloo Thambi 2 (800, Tamil subset) | `baloo-thambi-2-tamil-800-normal.woff2` | EkType, via `@fontsource/baloo-thambi-2` 5.3.0 | `OFL-BalooThambi2.txt` |

The fonts are self-hosted (no third-party requests) and declared with `unicode-range`, so a phone or TV only
downloads a script's font when that script is on screen.

### Sounds (`apps/web/public/assets/`), CC0 1.0 (public domain)
| Pack | Files used | Source | Licence file |
|---|---|---|---|
| Kenney Interface Sounds 1.0 | buzzer, ticks, confirmation, error, pluck, select, drop, glass, maximize | https://kenney.nl/assets/interface-sounds | `kenney-interface/License.txt` |
| Kenney Music Jingles | `jingles_SAX03`, `jingles_HIT00`, `jingles_STEEL00` | https://kenney.nl/assets/music-jingles | `kenney-jingles/License.txt` |
| Kenney Voiceover Pack #1 (female voice) | ready, go, correct, wrong, final round, hurry up, congratulations, time over | https://kenney.nl/assets/voiceover-pack | `kenney-voiceover/License.txt` |

The drumroll and the heartbeat under the timer are synthesised in code (Web Audio).

## Squat Rocket and camera mode

### 3D models and sounds (`apps/web/public/assets/`), CC0 1.0 (public domain)
| Pack | Files used | Source | Licence file |
|---|---|---|---|
| Kenney Space Kit | rocket base/fuel/top/fins, meteors, rocks, craters, hangar, satellite dish, platform, astronaut, generator (GLB) | https://kenney.nl/assets/space-kit | `kenney-space-kit/License.txt` |
| Kenney Sci-Fi Sounds 1.0 | spaceEngineLow, explosionCrunch, forceField, laserSmall, lowFrequency_explosion | https://kenney.nl/assets/sci-fi-sounds | `kenney-sci-fi-sounds/License.txt` |
| Kenney Interface Sounds 1.0 | pluck, confirmation, maximize, tick, error | https://kenney.nl/assets/interface-sounds | `kenney-interface-sounds/License.txt` |

### Body tracking (`apps/web/public/vendor/mediapipe-0.10.35/`), Apache License 2.0
MediaPipe Tasks Vision 0.10.35 wasm runtime (npm `@mediapipe/tasks-vision@0.10.35`) and the Pose Landmarker lite
model, self-hosted and unmodified: checksums and provenance in `SOURCE.txt`, licence in `LICENSE`. Runs only on
the phone, and only in camera games.

## 3D kit and Pillow Fort Brawl packs

Everything here is CC0 1.0 (public domain dedication): free to use, modify and redistribute, no attribution
required. We credit the authors anyway. Each pack's own licence file is copied next to its files under
`apps/web/public/assets/<pack>/`. Games list the packs they use in their manifest's `licenceInventory`
(`packages/protocol/src/catalog.ts`).

Rules for adding assets: CC0 or similarly permissive only (no CC-BY-SA, GPL, NC, or Mixamo raw files);
glTF/GLB without Draco, meshopt or KTX2 (our CSP allows no WebAssembly); ship only the files a game uses.

| Pack | Author | Licence | Source | Used by | Files |
|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-adventurers (also github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | Pillow Fort Brawl | `assets/kaykit-adventurers/` |
| KayKit Furniture Bits 1.0 | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-furniture-bits (also github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0) | Pillow Fort Brawl | `assets/kaykit-furniture/` |
| Impact Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/impact-sounds | Pillow Fort Brawl | `assets/kenney-audio/impact*.ogg` |
| Interface Sounds | Kenney | CC0 1.0 | https://kenney.nl/assets/interface-sounds | Pillow Fort Brawl | `assets/kenney-audio/` (pluck, tick, drop, glass, scratch, bong, confirmation, maximize, minimize) |
| RPG Audio | Kenney | CC0 1.0 | https://kenney.nl/assets/rpg-audio | Pillow Fort Brawl | `assets/kenney-audio/cloth*.ogg` |
| Voiceover Pack (female voice) | Kenney | CC0 1.0 | https://kenney.nl/assets/voiceover-pack | Pillow Fort Brawl | `assets/kenney-audio/vo_*.ogg` |

## How the KayKit files were trimmed

The original character GLBs are ~3.6 MB each because every one embeds all 76 animations. We ship:

- `knight.glb`, `barbarian.glb`, `mage.glb`, `rogue.glb`: mesh + skin only, weapons removed (capes and hats
  kept), texture atlas downsampled to 128×128 (~240 KB each);
- `animations.glb`: the shared rig plus the 15 clips the game uses, resampled (~450 KB); clips bind to any of
  the four characters by bone name;
- `bedroom.glb`: the Furniture Bits pieces used for the room, merged into one file with one 256×256 atlas.

The processing used `@gltf-transform/core` + `functions` (prune, dedup, resample, textureCompress with
sharp) from a scratch directory; nothing of it is a project dependency.

## Cinematic pipeline test assets (`apps/web/public/assets/cinematic/showroom/`), used by `/tv/showroom`

Rendered with `tools/blender/` (see its README for the exact commands). CC0 1.0; licence files next to them.

| Source | Author | Licence | Source URL | Files made from it |
|---|---|---|---|---|
| Car Kit 3.1, `hatchback-sports.glb` | Kenney | CC0 1.0 | https://kenney.nl/assets/car-kit | `hatchback.webp`, `hatchback-normals.webp`, `hatchback.json` (16-direction sprites), `hatchback-high.glb`, `hatchback-ultra.glb` (re-exported with clear coat and baked AO), `ghat-loop.mp4`, `ghat-loop-poster.webp` |
| HDRI "Kloofendal Overcast (Pure Sky)" | Greg Zaal, Poly Haven | CC0 1.0 | https://polyhaven.com/a/kloofendal_overcast_puresky | `kloofendal_overcast_puresky_1k.hdr` (shipped as is), lighting of `ghat-loop.mp4` (2k, not shipped) |
| HDRI "Studio Small 08" | Sergej Majboroda, Poly Haven | CC0 1.0 | https://polyhaven.com/a/studio_small_08 | lighting of the sprite sheets (2k, not shipped) |

Licence files: `LICENSE-kenney-car-kit.txt`, `LICENSE-polyhaven.txt`. The road, hills and lighting rig of the video
are generated by `render_backdrop.py`. No brand marks: the Kenney car has none.

## GHAT RUSH (`apps/web/public/assets/ghat-rush/`)

Vehicles, the bus and the goat are original models built from primitives by `tools/blender/models/ghat_rush.py`
(CC0 1.0, like the code), rendered with `tools/blender/render_sprites.py` (32 directions for the racers, 16 for
traffic and goats, 10° camera pitch, monsoon light preset, + normal sheets) and exported with
`tools/blender/export_glb.py` (`-high.glb`, used by high and ultra). Track, terrain, road and sky textures, HUD and the
engine, rain, thunder and goat-horn sounds are made in code. About 4 MB in all.

| Source | Author | Licence | Source URL | Files made from it |
|---|---|---|---|---|
| Original models (auto-rickshaw, scooter + rider, hatchback, ghat bus, goat) | Play With TV | CC0 1.0 | `tools/blender/models/ghat_rush.py` | `auto.*`, `scooter.*`, `car.*`, `bus.*`, `goat.*` (`.webp` sprites, `-normals.webp`, `.json`, `-high.glb`) |
| Car Kit, `truck.glb` | Kenney | CC0 1.0 | https://kenney.nl/assets/car-kit | `lorry.webp`, `lorry-normals.webp`, `lorry.json`, `lorry-high.glb` |
| Nature Kit (palms, trees, bushes, rocks) | Kenney | CC0 1.0 | https://kenney.nl/assets/nature-kit | `props.glb` (10 props merged; recoloured to monsoon greens at load) |
| HDRI "Kloofendal Overcast (Pure Sky)" | Greg Zaal, Poly Haven | CC0 1.0 | https://polyhaven.com/a/kloofendal_overcast_puresky | shared with the showroom (`cinematic/showroom/kloofendal_overcast_puresky_1k.hdr`), high/ultra lighting |
| Impact, interface and cloth sounds, countdown voice | Kenney | CC0 1.0 | https://kenney.nl/assets | shared `kenney-audio/` files |

Licence files: `LICENSE.txt`, `LICENSE-kenney-car-kit.txt`, `LICENSE-kenney-nature-kit.txt`. No brand marks, badges or
number plates (plates are blank).
