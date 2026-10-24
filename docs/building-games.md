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
