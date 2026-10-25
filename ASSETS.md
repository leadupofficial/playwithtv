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

## Gully Super Over (`apps/web/public/assets/gully/`)

Everything in the lane is original: modelled from code in Blender (`tools/blender/scenes/gully_lane.py`,
`gully_props.py`, `gully_kit.py`, procedural textures in `gully_textures.py`) — the houses, kolams, mural, bunting,
auto-rickshaw (no markings or plates), the sleeping dog, the brick stumps and the taped bat. `lane.glb` (high/ultra),
the backdrops `gully-broadcast.webp`, `gully-shot.webp`, `gully-side.webp` and `gully-lane.json` (camera rigs) are
rendered/exported from that scene. Commentary lines, HUD and the crowd roar are original too.

| Source | Author | Licence | Source URL | Files made from it |
|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 (knight, mage, rogue + rig) | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-adventurers | `animations.glb` (19 clips: idle, run, swing, block, throw, cheer …, trimmed with gltf-transform), `sprites/*.webp` + `.json` (lite sprite sheets: two team jerseys × 7 clips, balcony kids); the real-time tiers reuse `assets/kaykit-adventurers/*.glb` |
| HDRI "Qwantani Sunset (Pure Sky)" | Greg Zaal, Jarod Guest, Poly Haven | CC0 1.0 | https://polyhaven.com/a/qwantani_sunset_puresky | `sky_1k.hdr` (shipped), lighting of the backdrops and sprites (2k, not shipped) |
| Impact / Interface / RPG sounds, Music Jingles, Voiceover Pack | Kenney | CC0 1.0 | https://kenney.nl/assets | reused from `assets/kenney-audio/` and `assets/kenney-jingles/` |

Licence files: `LICENSE-kaykit.txt`, `LICENSE-polyhaven.txt` (and `sprites/LICENSE-kaykit.txt`). Rebuild:
`blender -b --factory-startup -P tools/blender/scenes/gully_lane.py -- --work <tmp> --hdri <2k hdr> --glb
apps/web/public/assets/gully/lane.glb --bake-ao 2048 --render apps/web/public/assets/gully --samples 96` and
`sh tools/blender/scenes/gully_sprites.sh <tmp>`.

## Kalari Clash (`apps/web/public/assets/kalari-clash/`)

Made with `tools/blender/kalari/` (commands in each script's docstring). Licence files next to the outputs:
`LICENSE-kaykit-adventurers.txt`, `LICENSE-ambientcg.txt`, `LICENSE-polyhaven.txt`.

| Source | Author | Licence | Source URL | Files made from it |
|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0 (full GLBs with all 76 clips) | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-adventurers | `simha.glb`, `mayil.glb`, `puli.glb`, `ashwa.glb` (restyled by `fighters.py`: weapons, helmets, hats and capes removed except Mayil's cape, palettes repainted, sash/turban/headband/peacock crest/bamboo staff modelled), `anims.glb` (31 clips), `*-sprites.webp/json` (8-direction sheets rendered by `fighter_sprites.py`) |
| PavingStones070, PavingStones138, RoofingTiles012A, Planks037A | Lennart Demes, ambientCG | CC0 1.0 | https://ambientcg.com | textures inside `courtyard.glb`, `docks.glb`, `rooftop.glb` (512 px, tinted) and the lighting of `*-lite.webp` / `*-card.webp` |
| HDRIs Qwantani Dusk 2, Kloppenheim 06 (pure skies) | Greg Zaal, Poly Haven | CC0 1.0 | https://polyhaven.com | `qwantani_dusk_2_puresky_512.hdr`, `kloppenheim_06_puresky_512.hdr` (shipped), 2k versions light the backdrops (not shipped) |
| HDRI Kloofendal Overcast (pure sky) | Greg Zaal, Poly Haven | CC0 1.0 | https://polyhaven.com | the 1k file is shared from `assets/cinematic/showroom/`; 2k lit `docks-lite.webp` |
| Kenney Impact Sounds, Interface Sounds, RPG Audio, Voiceover Pack | Kenney | CC0 1.0 | https://kenney.nl/assets | reused from `assets/kenney-audio/` (no new files) |

The arenas themselves (temple courtyard, harbour docks, coconut-grove rooftop: geometry, palms, lamps, boats) are
modelled procedurally by `arenas.py` / `arena_kit.py` and are original to this repository. Fighter names and
designs (Simha, Mayil, Puli, Ashwa) are original.

## Tiffin Tornado (`apps/web/public/assets/tiffin/`)

Made with `tools/blender/tiffin/` (see its README for the exact commands). The kitchen carriage, every South Indian
dish and utensil (dosa, idli, vada, chutney, sambar, filter coffee, tava, idli steamer, kadai, wet grinder, coffee
filter, matka, tiffin carriers), the window scenery and the chefs' toques and aprons are original, modelled in
code. Third-party sources, all CC0 1.0 (licence files next to the outputs: `LICENSE-kaykit-restaurant-bits.txt`, `LICENSE-kaykit-adventurers.txt`, `LICENSE-polyhaven.txt`):

| Source | Author | Licence | Source URL | Used for |
|---|---|---|---|---|
| KayKit Restaurant Bits 1.0 (counters, stoves, sink, cutting board, knife, dish rack; palette repainted) | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/restaurant-bits (github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0) | `kitchen-*.webp` backdrops, `kitchen-*.glb` |
| KayKit Character Pack: Adventurers 1.0 (Knight, Barbarian, Mage, Rogue bodies, re-dressed as chefs) | Kay Lousberg | CC0 1.0 | https://kaylousberg.itch.io/kaykit-adventurers | `chef-1..4.webp/.json` sprite sheets, `chef-1..4.glb`; the real-time chefs animate with the existing `kaykit-adventurers/animations.glb` |
| HDRI "Kloofendal 48d Partly Cloudy (Pure Sky)" | Greg Zaal, Poly Haven | CC0 1.0 | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | lighting of the backdrops and scenery (2k, not shipped) |
| HDRI "Studio Small 09" | Sergej Majboroda, Poly Haven | CC0 1.0 | https://polyhaven.com/a/studio_small_09 | lighting of the chef and food sprites (2k, not shipped) |
| HDRI "Kloofendal Overcast (Pure Sky)" | Greg Zaal, Poly Haven | CC0 1.0 | already shipped in `cinematic/showroom/` | real-time image-based light (high/ultra) |
| Kenney Interface Sounds, Impact Sounds, RPG Audio, Voiceover Pack | Kenney | CC0 1.0 | https://kenney.nl/assets | the existing `kenney-audio/` files; sizzle, rails, horn and bell are synthesised in code |

## kitplat platformers: Monsoon Courier, Lantern Lane, Stepwell Secrets (`apps/web/public/assets/plat/`)

Every picture is original to this repository: modelled from primitives in Blender Python and rendered by
`tools/blender/kitplat/` (`render_all.sh`), released like the code. Nothing was traced, imported or adapted from
another game: the heroes (Keeri the mongoose courier, Diya the festival kid, Asha the step-well explorer), foes (rain
crab, frog, crow, pangolin, clay-pot walker, paper-lantern ghost, jewel beetle, bat), bosses (the Mango Bandit, the
Grumble Puppet, the Stone Makara), tiles, pick-ups, power-ups (umbrella, chai, tiffin magnet, kite, sparkler, lantern
shield, Garuda feather, temple bell, oil lamp) and the parallax backdrops (monsoon rooftops, festival night,
step-well galleries). No HDRIs or third-party textures: materials are procedural, lights are Blender suns.

| Folder | Files | Size |
|---|---|---|
| `plat/keeri/`, `plat/diya/`, `plat/asha/` | hero sheets (`<hero>.webp` + `.json`, 11 clips, ~60 frames) | ~210 KB each |
| `plat/monsoon/`, `plat/festival/`, `plat/stepwell/` | `tiles-*`, `items-*`, `foes-*` atlases (+ `.json`), `bg-*-{sky,far,mid}.webp` + `-lite.webp` (1280×720), `bg-*-fg.webp` (high/ultra only) | 0.5–0.8 MB each |

Sounds reuse the existing CC0 Kenney files in `assets/kenney-audio/` (Impact Sounds, Interface Sounds, RPG Audio,
Voiceover Pack) and `assets/kenney-jingles/` (Music Jingles); jump, gem, spring, power-up and fanfare blips are
synthesised in code (`games/kitplat/audio.ts`). No new third-party files were added.
