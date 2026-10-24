# Building a game for Play With TV

The TV renders the game. Each phone is that player's controller, in the **control mode they chose**:

| Mode | The phone shows | Good for |
|---|---|---|
| `buttons` | a stick (joystick, ◀ ▶ arrows, 4 arrows, or none) plus action buttons | fighting, platformers, anything precise or fast |
| `motion` | "watch the TV"; tilt plus gestures (push, flicks, twist, shake) | maze, bowling, golf, party fun |
| `hybrid` | tilt for movement plus on-screen action buttons | racing (tilt the "wheel", tap Boost) |
| `touchpad` | a trackpad: drag to move or aim, swipe or tap for actions | slicing, air hockey, aiming |
| `camera` | the phone, propped up 2–3 m away, watches the player's body; a big rep counter | fitness: squats, jumps, jacks |

**Think about which modes make your game fun.** Offer every mode that plays well, best first, and leave out
the ones that don't. A game never needs to know which mode a player picked: it receives the same signals
either way.

## The signals

```
movement   get(id).x, get(id).y         in [-1, 1]; x right, y up/forward (stick, tilt or touchpad)
actions    onAction((id, action) => …)  a button press, a mapped gesture, or a swipe/tap
held       get(id).held("block")        true while a `hold` action's button is held
raw tilt   get(id).roll / .pitch        motion and hybrid only (e.g. lean to dodge)
mode       kit.mode(id)                 "buttons" | "motion" | "hybrid" | "touchpad" (to tune feel)
ready      get(id).ok                   the controller is live (and calibrated when tilting)
```

## Data flow

```
phone: GamePad (mode) ─► InputSender ══ direct WebRTC link (same Wi-Fi) ══► TvInputs ─► ControlReader ─► game
                                      ╲═ws═► hub relay (fallback) ═ws════╱    (merged by sequence number)
```

The phone calibrates tilt automatically (hold still for under a second). It maps gestures and swipes to your
actions using your ControlSpec, so the TV only ever sees actions. Direct links make input take about 8 ms on
the same Wi-Fi.

## Step by step

### 1. Declare the controls

```ts
import type { ControlSpec } from "@playwithtv/protocol";

export const CONTROLS: ControlSpec = {
  title: "Bowling Master",                 // also the key players' mode choice is remembered under
  modes: ["motion", "buttons", "touchpad"],// best first: the default for new players
  stick: "arrows-h",                       // buttons mode movement: "joystick" | "arrows-h" | "arrows" | "none"
  tilt: "aim",                             // what tilting means (hint only)
  actions: [
    { id: "roll", label: "🎳 ROLL", color: "#2f8cff", gestures: ["push"], swipes: ["swipe-up"] },
    { id: "spin", label: "SPIN", hold: true },                          // held while pressed
    { id: "power", label: "POWER", strongOf: "roll" },                  // a strong push = power roll
    { id: "lock", label: "Lock", gestures: ["push"], buttonIn: [] },    // motion-only action (no button)
  ],
  hints: {                                  // one line per offered mode, shown on the TV and phone
    motion: "Turn to aim, push towards the TV to roll (harder = faster)",
    buttons: "◀ ▶ to aim, tap ROLL",
    touchpad: "Drag to aim, swipe up to roll",
  },
};
```

Action ids are short (16 characters at most). `buttonIn` defaults to buttons and hybrid; touchpad shows a
button only if you list it. Gestures only fire in `motion`; in `hybrid` the buttons do the actions, so a bump
can't trigger one.

### 2. Write the rules as a pure engine with tests

Put physics and rules in a pure module (no React, no DOM) with a Vitest file next to it. Examples:
`games/maze/physics.ts`, `games/racer/engine.ts`, `games/boxing/engine.ts`. Use a fixed time step
(1/60 s), seedable randomness, and an explicit end state.

### 3. Build the TV component

```tsx
export function BowlingGame({ players, bridge, paused, onFinish }: GameProps) {
  const ids = useRef(players.filter((p) => p.connected).slice(0, 4)).current;
  const kit = useRef<ControlPlayers | null>(null);
  kit.current ??= new ControlPlayers(bridge, ids.map((p) => p.id), CONTROLS);
  const [practising, setPractising] = useState(true);
  useEffect(() => { kit.current!.start(); return () => kit.current!.dispose(); }, []); // start() is idempotent
  if (practising) return <div className="tv"><ControlTutorial title="🎳 Bowling Master" players={ids} kit={kit.current}
    practice={["roll"]} quick={QUICK} onDone={() => setPractising(false)} /></div>;
  return <Play ids={ids} kit={kit.current} paused={paused} onFinish={onFinish} />;
}
```

- Read movement every frame with `kit.get(id).x/y` (only when `.ok`), and react to `kit.onAction`.
- Tell phones what is happening with `kit.status(id, { text, bars })`, `kit.toast(id, text, tone)` and, at the
  end, `kit.outcome(id, text, emoji)`.
- Draw on a canvas (2D, or three.js for 3D) sized to the 1920×1080 stage. Keep the internal resolution at
  1280×720 and lazy-load heavy code.
- Low-end TVs (1–2 GB): avoid per-frame allocations, big shadow maps and physically based materials on large
  surfaces (see the maze's lite mode). Aim for 60 fps on a Mali-G31.
- `?quick=1` on the TV URL should make the game short, for tests and demos.
- When `paused` is true (the TV lost its connection), freeze the simulation.
- Finish with `onFinish(results, durationMs)`, where `results = [{ playerId, score, place }]`. Use
  `games/scoring.ts` `placings()` for standard ranking. The platform shows results and offers a rematch.
- Expose a `data-<game>` attribute with a small JSON debug state (phase, scores, positions), so browser tests
  can follow the game.

### 4. Manifest and registration

Add a manifest (see `packages/protocol/src/catalog.ts`) with:
- `controller: "game"` and `controlModes`;
- `completionStatus: "playable"` only when the loop is complete and tested;
- `catalogueNo` if the game is from the catalogue, `modes`, and `licenceInventory`.

Then register the component in `apps/web/src/games/registry.ts` (lazy-load anything heavy) and run
`pnpm docs:catalogue`.

### 5. Test it like a player

Add a Playwright test in `e2e/` that plays your game end to end. `e2e/helpers.ts` gives you:
- phones with a synthetic motion sensor: `joinPhone(browser, code, name, { "Your Title": "buttons" })` presets
  the mode;
- `press(phone, "ROLL")` and `hold(phone, ".arrow-right", ms)` for buttons;
- `pose()` and `gesture()` for motion;
- `practiseUntilReady()` for the get-ready screen.

Cover your default mode fully, and at least one other mode.

## Rules for every game

- **Original content only:** your own art, names, sounds and levels (drawn or synthesised in code), or assets
  with a compatible licence listed in `licenceInventory`. No copyrighted characters, brands or music.
- **Gentle motion:** controlled flicks, never throwing or hard swinging.
- **Complete:** a clear objective, feedback, scoring, an end state, and a rematch path.
- **Fair for mixed modes:** if two players use different modes, neither should have a big advantage (tune by
  `kit.mode(id)` if needed).
- **Family friendly:** short rounds, readable from the sofa (big text on the 1920×1080 stage).

## Testing motion with real recordings

- **Live check:** open `/sensors` on a phone to see live tilt, sample rate and detected gestures.
- **Recording:** "Record 10 seconds" downloads a JSON trace.
- **Using a trace:** put real traces in `packages/motion/test/fixtures/` and replay them with `replay(trace)`.

## Tilt and gesture details (motion SDK)

- **Calibration:** neutral is whatever pose the player held at calibration, so upright ("steering wheel") and
  flat ("tray") both work.
- **Tilt shaping:** a 3° dead zone, full deflection at 28°, and per-player sensitivity.
- **Gesture vocabulary:** `push`, `pull`, `flick-up/down/left/right`, `twist-left/right` (needs a gyroscope)
  and `shake`.
- **No repeats:** one movement is one action, with a cooldown and settle time. Single knocks and noise are
  rejected.
- **Swings (bat, racket):** map the gesture `"swing"` (e.g. `gestures: ["swing"]`) and the phone also runs
  `SwingDetector` (`packages/motion/src/swing.ts`): any direction, reported at the swing's peak, with a continuous
  strength (~1.2 gentle, 2 a proper swing, 3+ a slog). Every gesture's strength reaches the TV with its tap as
  `kit.get(id).gesture`. Gully Super Over times its shots with it.

## Camera fitness controllers

In `camera` mode the phone is propped up (landscape, about hip height, 2–3 m away, front camera facing the
player) and tracks the body itself with MediaPipe Pose Landmarker lite (`apps/web/src/phone/camera/`). The video
never leaves the phone; the TV receives the same signals as any other mode:

```
actions   onAction: a pose move mapped to your action (squat, jump, jack, raise, punch, hands-on-head)
x         lean, -1 (player's left) … 1 (player's right): dead zone ±3°, full at ±15°
y         squat depth 0…1
ok        calibrated and tracking the player (false = "step back / move into the light": don't penalise them)
raw axes  s = seated (0/1), i = intensity (0 gentle, 0.5 normal, 1 sweaty), q = latest squat form 0…1,
          cs = camera state (0 off, 0.25 setting up, 0.5 calibrating, 0.75 lost, 1 tracking);
          read them with bridge.onInput (see games/squat-rocket)
```

Map moves to actions in the ControlSpec, with an upper-body alternative for seated players:

```ts
{ id: "pump", label: "⛽ PUMP", gestures: ["push"], poses: ["squat"], seatedPoses: ["raise"] },
{ id: "pause", label: "⏸ Pause", poses: ["hands-on-head"], buttonIn: ["buttons"] }, // also a big Pause button on the camera pad
```

- **Pipeline (pure, tested):** `poseActions.ts` + `moves.ts`: One-Euro smoothing, visibility > 0.6, a 3 s
  calibration that refuses to start until feet and hands are in view, re-calibration when the player's size
  changes by more than 20 %, and per-move state machines (hysteresis, ~120 ms dwell, refractory periods). Tune
  with synthetic bodies (`synthetic.ts`) in `poseActions.test.ts`.
- **Timing:** camera moves arrive ~150 ms after the movement. Give timing windows at least 100 ms of forgiveness
  on both sides, and reject spamming (one move per cue).
- **Fairness and safety:** reward rhythm and form, never speed or jump height; cap rep rates by the player's
  intensity; offer a seated variant of every move; start with a short warm-up; pause on hands-on-head; never
  penalise a player while `ok` is false. Always offer `buttons` (and `motion`) too: "Play with buttons instead"
  on the phone switches mode, for phones without a camera or too slow to track.
- **Loading:** the camera code and ~17 MB of wasm and model load only when a camera game starts on that phone
  (the service worker caches them). The phone page's CSP allows WebAssembly for this (see `docs/security.md`).
- **Browser tests:** Chromium's fake camera shows nobody, so set `window.__fakePose = { queue: [], base: {}, done: 0 }`
  on the phone before the camera starts and push moves (`"squat"`, `"jump"`, `"jack"`, `"arm-jack"`, `"raise"`,
  `"punch"`, `"head"`, `"lean-left"`): synthetic landmarks go through the real pipeline. Launch Chromium with
  `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (see `e2e/squat-rocket.spec.ts`).
- **Real devices:** frame rate and accuracy still need checking on real phones in real living rooms.

## The shared 3D kit (`apps/web/src/games/kit3d/`)

Small, generic modules for real-looking 3D games that still run at 60 fps on a 1 GB Android TV (Mali-G31,
fill-rate bound). Pillow Fort Brawl (`games/brawl/`) is the reference user.

| Module | What it gives you |
|---|---|
| `assets.ts` | `loadGltf(url)` (cached per URL), `loadAll(urls, onProgress)`, `cloneModel()` (SkeletonUtils, so skinned copies animate alone), `cheapMaterials(root, "toon" \| "lambert")` (PBR → cheap, keeps the texture), `disposeTree()` |
| `character.ts` | `Character`: an animated model with crossfading `play(clip, { once, timeScale, from })`, frozen `pose(clip, t)` / `resume()`, `attach(bone, obj)`, `tint()`, white hit `flash()`, `head()`. Structure `root → body → model`: move `root`, squash `body`. Clips from any file with the same rig bind by bone name |
| `labels.ts` | `Labels`: crisp HTML labels that follow 3D points (name tags, pop words); `nameTag(name, colour)` |
| `blobShadow.ts` | `blobShadow(radius)` and `fadeBlob(mesh, height)`: soft round shadows instead of shadow maps |
| `juice.ts` | `GameClock` (hit-stop, slow motion), `Shake` (trauma-based, capped), `Squash` (squash-and-stretch spring), `Announcer` (big pop-in text) |
| `followCamera.ts` | `FollowCamera`: fixed 3/4 angle that frames all given points (zooms out as players spread), `punch()` in on a moment, `orbit()` for intro flyovers |
| `particles.ts` | `Particles`: pooled bursts in one InstancedMesh (one draw call), with drag, flutter and resting on a floor; `featherGeometry()`, `sparkleGeometry()` |
| `podium.ts` | `Podium` (1-2-3 steps to stand characters on) and `showAwards(overlay, heading, cards)` |
| `audio.ts` | `SampleBank`: WebAudio samples with per-play volume and pitch (random variants per name) |

Rendering recipe the kit assumes: render at 1280×720 with `antialias: false` and pixel ratio 1, Lambert/Toon
materials with a hemisphere light plus one directional light, fog, no shadow maps, no post-processing, merge
static scenery that shares a material (`BufferGeometryUtils.mergeGeometries`), instance repeated things, and
lazy-load the game in `registry.ts`. Expose the frame rate and `renderer.info.render.calls` in your debug
attribute. Assets: CC0 glTF/GLB only, without Draco/meshopt/KTX2 (no WebAssembly under our CSP), trimmed to the
files you use, credited in `ASSETS.md` and `licenceInventory`.
Load models with the kit's `loadGltf()`, not a bare `GLTFLoader`: three's default path decodes GLB textures by
`fetch()`ing a `blob:` URL, which our CSP's `connect-src` blocks in production (textures silently go missing);
the kit decodes them through an `<img>` instead.

## Cinematic games: tiers and the Blender pipeline

For "PlayStation-looking" games (GHAT RUSH, KALARI CLASH, GULLY SUPER OVER, TIFFIN TORNADO …). The same game runs
on three **render tiers**; the look on the weakest one comes from assets pre-rendered in Blender, not from the TV's
GPU. Open `/tv/showroom` (TV route, remote-friendly) to see one car in every tier; `?quality=lite|high|ultra`
forces a tier on any page.

| Tier | Where | How it looks premium | Budget |
|---|---|---|---|
| `lite` | the owner's TV: 1 GB, Mali-G31, WebView | Blender-lit **sprite sheets** (16 directions, contact shadows, rim light, AgX) + **H.264 video loops** (hardware-decoded) + cheap 3D for the playfield | 1280×720, no shadow maps, no post, Lambert/Toon, 1–10 draw calls for sprites |
| `high` | a better TV box, a laptop with integrated graphics | real-time PBR, HDRI image-based light, soft shadow map, AgX, bloom + FXAA | 1920×1080, 1024 px shadows, textures ≤ 1024 |
| `ultra` | a laptop/PC with a strong GPU casting or on HDMI ("power-host mode") | as high + GTAO ambient occlusion, SMAA, bigger shadows | 2560×1440, 2048 px shadows, textures ≤ 2048 |

### Reading the tier (`apps/web/src/quality/`)

```ts
import { useQuality, getQuality } from "../../quality/store";
const { tier, profile, ready } = useQuality();   // React; re-renders when the player changes the setting
const q = getQuality().profile;                   // plain code (engine, scene builders)
if (!ready) return <Loading />;                   // detection runs once per device (≤ 1.5 s, cached)
```

`QualityProfile` (`quality/tier.ts`) is what you branch on, never the tier name alone:
`resolution {w,h}` (drawing buffer of a full-stage canvas), `pixelRatioCap`, `msaa`, `materials`
(`lambert` | `standard` | `physical`), `envMap`, `shadows {enabled, mapSize, soft}`,
`post {level 0|1|2, bloom, ao, aa: none|fxaa|smaa}`, `toneMapping`, `maxTexture`, `particleBudget`
(150 / 800 / 3000), `assetSuffix` (`-lite` | `-high` | `-ultra`) and `prerendered` (true on lite: draw sprites and
video, not real-time models).

**How detection works** (`quality/detect.ts`, rules in `quality/tier.ts`, unit-tested in `tier.test.ts`):
1. Signals: WebGL renderer string (`WEBGL_debug_renderer_info`), `navigator.deviceMemory`, `hardwareConcurrency`,
   `MAX_TEXTURE_SIZE`, and the TV app's user-agent marker `PlayWithTV/1`.
2. Hardware cap (the lowest applies): weak/software GPU (Mali-4xx/T6–8xx/G31/G51/G52/G57, PowerVR SGX/GE/GX,
   Adreno ≤ 619, VideoCore, SwiftShader, llvmpipe) → lite; memory ≤ 1 GB → lite, ≤ 2 GB → high; ≤ 2 cores → lite,
   ≤ 4 → high; max texture < 4096 → lite, < 8192 → high; the TV app → high at most.
3. GPU micro-benchmark (≤ 1.2 s, raw WebGL, 1280×720 offscreen): full-screen layers of a lit, textured shader,
   doubled until a batch takes ≥ 30 ms. Score = 720p screens per 60 fps frame: < 8 → lite, < 60 → high, ≥ 60 →
   ultra (Apple M4 ≈ 370; SwiftShader ≈ a few). Ultra also needs a known strong GPU (Apple M, NVIDIA, Radeon RX/Pro,
   Intel Arc, Adreno 73x+, Mali-G6x/G7xx+).
4. The result is cached in `localStorage["pwtv.quality.detect"]` with a version and the GPU string; a new GPU (or a
   bumped `CACHE_VERSION`) re-runs it.
5. Precedence: `?quality=` (this page load) → the lobby chip "🎨 Graphics: Auto/Lite/High/Ultra" (saved per device,
   OK on the remote cycles it) → detection. On lite the lobby also offers "Console-quality graphics: cast from a
   laptop", which opens `/tv/hosting` (Chrome Cast tab, or HDMI).

### Lite tier: sprites and video (`apps/web/src/games/kit25d/`)

```ts
import { SpriteBatch, loadSpriteSheet } from "../kit25d/spriteBatch";
const sheet = await loadSpriteSheet("/assets/ghat-rush/auto.json", { normals: true });
const autos = new SpriteBatch(sheet, 8);         // ONE draw call for all 8 autos
scene.add(autos.mesh);
// per frame:
autos.set(i, { x, y: 0, z, heading, tint: player.color, scale: 1, time: t });
autos.update(camera, t);                         // picks direction cell + frame, sorts far → near
autos.setLight([-0.5, 0.8, 0.4], "#cfe0ff", flash); // optional relight through the normal sheet (lightning)
```

- `heading` is the object's world yaw, three.js style: forward = `(sin h, 0, cos h)`. `update()` converts it to the
  screen-relative heading the sheet is indexed by, so the camera may yaw freely. Keep the camera's **pitch** close
  to the sheet's `camera.elevationDeg` (default 30°), or render the sheet at your pitch.
- Sprites are screen-aligned quads whose `pivot` (the model's ground point) sits on `(x, y, z)`; world size comes
  from `pixelsPerMetre` × `scale`. They don't write depth: draw opaque 3D first, sprites after (the default order).
- `tint` recolours only saturated (paint) texels, keeping tyres, glass and the baked lighting: one sheet serves
  every player colour. Render the paint in a saturated mid colour.
- `manifest.ts` holds the pure maths (`directionIndex`, `frameAt`, `cellIndex`, `cellUv`, `worldSize`,
  `screenHeading`, `parseManifest`), unit-tested in `manifest.test.ts`.
- Backdrops: `<VideoBackdrop src=… poster=… paused={paused} />` under a canvas made with
  `new THREE.WebGLRenderer({ alpha: true })` and `setClearColor(0, 0)`. Muted + playsInline loops autoplay on TVs;
  the poster covers loading and browsers without H.264 (Playwright's Chromium does have it on macOS). The service
  worker leaves Range (video) requests alone.

### High and ultra: `kit3d/cinematic.ts`

```ts
import { createCinematic, prepareModel } from "../kit3d/cinematic";
const cine = createCinematic(canvas, profile, { scene, camera });   // renderer + post chain from the profile
await cine.environment(scene, "/assets/ghat-rush/sky_1k.hdr", { background: true, intensity: 0.6 });
cine.sun(scene, { position: [-4, 10, 5], extent: 8 });               // shadow camera covers ±8 m
const car = cloneModel((await loadGltf(`/assets/ghat-rush/auto${profile.assetSuffix}.glb`)).scene);
prepareModel(car, profile);                                         // shadows, env strength, anisotropy
loop: cine.render(scene, camera);                                   // RenderPass → GTAO → bloom → Output → FXAA/SMAA
cine.setBloom(0.6);                                                  // punch on a hit, then ease back to 0.22
```

`.hdr` (HDRLoader) and `.exr` (EXRLoader) fetch the same-origin file and decode in JavaScript: they work under the
CSP (tested in `e2e/showroom.spec.ts`). Use 1k HDRIs (~1.2 MB) for lighting; blur the background
(`blur: 0.04`) or replace it with your own scenery. Load GLBs only through `kit3d/assets.ts` `loadGltf()`.

### Making assets: the Blender pipeline (`tools/blender/`, see its README)

```sh
pnpm assets:sprites  --model auto.glb --hdri studio_small_08_2k.hdr --preset monsoon --directions 16 --size 256 \
                     --normals --no-png --out apps/web/public/assets/ghat-rush --name auto
pnpm assets:backdrop --scene ghat.blend --video --seconds 4 --path scene --out apps/web/public/assets/ghat-rush --name intro
pnpm assets:glb      --model auto.glb --tier high --bake-ao --out apps/web/public/assets/ghat-rush/auto-high.glb
```

Measured on an M4 (Blender 5.2.3): 16-direction 256 px sheet + normals ≈ 45 s; a 4 s 720p video loop ≈ 9 min
(24 samples, Cycles Metal + OIDN); GLB with baked AO ≈ 10–80 s. The first Cycles run compiles Metal kernels
(~4 min, once). Always look at the `--preview` PNG and a frame of the video before committing, and iterate on the
light preset.

**Recipe per game:** lite = sprites for every moving thing (vehicles, fighters, players: 8–16 directions,
idle/run/hit clips at 8–12 fps) + a video loop or layered stills for the world + simple Lambert geometry for
whatever the camera must move through; high/ultra = the same models as GLBs with PBR, the HDRI and the post chain.
Gameplay code is identical: only the view layer branches on `profile.prerendered`.

**Rules:** CC0 first (Kenney, Quaternius, KayKit, Poly Haven); CC-BY only with credit in `ASSETS.md` and
`licenceInventory`; no logos, brand names, number plates or raw Mixamo files; licence file next to the outputs;
keep a game's cinematic assets under ~8 MB (sprites as WebP; video 720p CRF ~23; ultra GLBs only when they differ).
