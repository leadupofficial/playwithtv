# Performance budgets

Play With TV has to run on the TVs people actually own: a ₹15,000 Android TV or a Fire TV Stick with a 1 GB Mali
GPU. One slow game makes the whole platform feel slow, so every game is measured automatically and a game over
its budget cannot be merged.

## How it is measured

`pnpm perf` (and the `perf` job in CI) builds the production app, opens a TV at the **lite** quality tier
(1280×720, what a weak TV gets), joins one phone, starts each playable game, waits for it to load and then
measures six seconds of play. Nothing in the game has to cooperate: the probe (`e2e/perf.ts`) wraps WebGL and
`requestAnimationFrame` from the outside, so a new game is checked the moment it is in the catalogue.

```bash
pnpm perf                                # every game, fails on any budget
PERF_GAME=lantern-lane pnpm perf         # one game
PERF_REPORT=1 pnpm perf                  # measure and print, never fail
```

Results are written to `test-results/perf/<game>.json`, printed as a table and, in CI, shown on the run's summary
page and uploaded as the `perf-results` artifact.

Before the browser run, `pnpm test` already checks each manifest (`apps/server/test/catalog.test.ts`): the
declared `estimatedAssetKb` and the files in `assetManifest` must fit the game's class.

## The budgets

A game declares its class with `perfClass` in its manifest (`packages/protocol/src/catalog.ts`); no
`perfClass` means **light**. The numbers live in `packages/protocol/src/perfBudget.ts`.

| Measured (lite tier, per frame unless noted) | light (default) | camera | heavy |
|---|---|---|---|
| Draw calls, 95th percentile | ≤ 60 | ≤ 60 | ≤ 160 |
| Triangles, 95th percentile | ≤ 60 k | ≤ 60 k | ≤ 400 k |
| Peak GPU texture memory | ≤ 64 MB | ≤ 96 MB | ≤ 192 MB |
| Download after Start | ≤ 2 MB | ≤ 20 MB | ≤ 12 MB |
| JavaScript per frame, 95th percentile | ≤ 8 ms | ≤ 10 ms | ≤ 14 ms |
| Start → game on screen (local server) | ≤ 15 s | ≤ 30 s | ≤ 30 s |

- **light** – runs smoothly on any TV. Choose this. Simple shapes, sprites, or the pre-rendered "modern retro"
  look (3D models rendered to sprites in Blender, see `tools/blender`) all fit easily: the platformers draw 7–8
  calls a frame.
- **camera** – drawing like *light*, plus the one-off body-tracking model (versioned under `/vendor/`, cached for a
  year).
- **heavy** – real-time 3D that needs a mid-range TV. Allowed, but labelled, and a maintainer has to agree
  before a new game uses it.

**Frame rate is printed but not enforced.** CI has no GPU and draws with software GL, so fps there says little
about a TV. The enforced numbers are the ones that do not depend on the machine (draw calls, triangles, texture
memory, bytes) plus the JavaScript time per frame, which has wide headroom. Real frame rates come from real TVs:
see `docs/real-device-test.md` and `docs/compatibility.md`.

## If your game is over budget

| Over | Usual fix |
|---|---|
| Draw calls | Put sprites in one atlas and draw them with one instanced mesh / one sprite batch; merge static geometry; no per-object materials |
| Triangles | Lower-poly models on lite (`quality` tier), or pre-render them to sprites |
| Texture memory | Smaller textures on lite (1024 px max), WebP/KTX2, drop unused mip levels, dispose textures when the game ends |
| Download | Compress (WebP / Ogg / Draco or meshopt glTF), share assets with the genre kit, load later levels lazily |
| JavaScript per frame | No allocation in the frame loop, fixed-step physics, spatial grid instead of all-pairs checks |
| Load time | Start drawing before every asset is in; show the get-ready screen while the rest loads |

The genre kits (`apps/web/src/games/kitplat`, `kit25d`, `kit3d`) already stay inside the light budget; a game
built on a kit inherits that.
