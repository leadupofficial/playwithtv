# Motion controls: how they work and how to build a game on them

The TV shows the game; the phone is only a motion sensor. After a one-time setup tap (join, allow motion,
start), nobody touches the phone screen while playing.

## Data flow

```
phone browser                                                                   TV browser
DeviceMotion ─► PhoneMotion ─► MotionEngine ─► InputSender ══ direct WebRTC link (same Wi-Fi) ══► TvInputs ─► MotionReader ─► game
 (60 Hz)        screen axes     tilt + gestures   axes 20 Hz   ╲                                  ╱ (merged by seq)
                                                  taps on change ╲═ws═► hub relay (fallback) ═ws═╱
```

**Direct links (the hub as a switch).**
- **Setup:** when a phone connects, it offers a WebRTC data channel to its TV. The hub only relays that
  handshake (`rtc.signal`), checking that both are authenticated in the same room, with sizes capped and
  rates limited.
- **Same Wi-Fi:** motion frames then go phone → TV directly over the home network, with no server round trip
  and no server bandwidth. Measured on the Xiaomi TV: about 8 ms direct vs about 244 ms via the server in
  Europe.
- **No outside servers:** no STUN/TURN servers are used, so a link only forms on the same network and no IP
  address is shared with third parties.
- **Fallback:** if a link cannot open within 8 s, the phone keeps using the server and retries later.
- **Merging on the TV:** the TV merges both paths by sequence number, so a frame arriving both ways counts
  once.
- **What still goes through the hub:** layouts, events and room state, which are low-frequency.
- **Status display:** the phone's status chip shows "⚡ Direct" or "☁", and the TV lobby marks direct
  players.
- **Turning it off:** `?p2p=0` disables direct links on a device (remembered); `?p2p=1` re-enables them.

- **`packages/motion`** (`@scp/motion`) is pure TypeScript: no DOM, no timers. It runs the same in the phone,
  the TV and the tests.
- **Phone:** `apps/web/src/phone/motion.ts` adapts browser events, and `MotionPad.tsx` is the one controller
  every game uses.
- **TV:** `apps/web/src/games/motionKit.ts` (`MotionPlayers`) and `MotionTutorial.tsx` handle calibration and
  practice.

## What the phone sends

The protocol's generic controller state carries motion as follows:

| field | meaning |
|---|---|
| `axes.roll` | turn like a steering wheel / lean sideways, −1 left … 1 right |
| `axes.pitch` | tip the top edge away (+) or towards you (−) |
| `axes.yaw` | turning rate around the vertical axis (gyroscope phones only) |
| `axes.ok` | 1 = calibrated and sensors live; games ignore tilt when 0 |
| `taps.<gesture>` | counter per gesture; `taps["<gesture>!"]` counts strong ones (strength ≥ 2) |
| `taps.calibrated` | increments each time the player finishes calibrating |

Counters, not events, are used so that a lost packet never loses or repeats an action. The TV diffs them. A
reloaded phone (counters back at zero) or a disconnect starts a fresh baseline.

## Tilt

- **Neutral:** whatever pose the player holds at calibration is "neutral". Calibration happens automatically
  at the start of every game, as soon as the phone is held still (or after 4 s), and again on "Re-centre".
- **Calibration frame:** all tilt is measured against that pose, so the same code works for:
  - a phone held upright like a steering wheel (racing, trivia, boxing);
  - a phone lying flat like a tray (maze).
- **Gravity filter:** gravity is separated from movement with a low-pass filter whose time constant is
  independent of the sample rate.
- **Output shaping:**
  - a dead zone (3°);
  - full deflection at 28° past the dead zone;
  - a per-player sensitivity (0.5–2, saved on the phone).

## Gesture vocabulary

`push` (towards the TV), `pull`, `flick-up`, `flick-down`, `flick-left`, `flick-right`, `twist-left`,
`twist-right` (needs a gyroscope), and `shake`.

- **Direction:** taken from the first strong acceleration in the calibrated frame. The braking that follows a
  movement can't flip it.
- **Must be sustained:** a single spike (a knock on the table, one bad sample) is rejected.
- **No repeats:** after a gesture there is a 280 ms cooldown, and the phone must settle before the next one.
  One movement is one action.
- **Shake:** five quick reversals in 0.7 s; separate pushes never add up to a shake.
- **Gentle:** thresholds are tuned for controlled flicks, not throws. Games must never reward violent swings.

## Building a game

1. **Manifest:** add one to `packages/protocol/src/catalog.ts` with:
   - `controller: "motion"`;
   - `motionMappings`, `calibrationProfile`, `sensorRequirements`, `modes`, `licenceInventory`;
   - `completionStatus: "prototype"` until the loop is complete.
2. **Pure engine:** put the rules and physics in a pure module with unit tests (see `games/maze/physics.ts`,
   `games/racer/engine.ts`).
3. **TV component:** create `MotionPlayers` for the players, call `start()` in an effect and `dispose()` in its
   cleanup, then `controls("all", title, moves)`. Show `MotionTutorial` with the gestures to practise, then run
   the game.
4. **Reading input:** read `kit.get(id).roll/pitch` every frame (only when `.ok`), and react to
   `kit.onGesture`.
5. **Talking to phones:** send `kit.status` (text and bars), `kit.toast` and `kit.outcome`. Never ask for
   touches.
6. **Finishing:** call `onFinish(results)`. The platform then shows results and offers a rematch.
7. **Registration and tests:** register the game in `games/registry.ts` (lazy-load anything heavy, like
   three.js). Add a Playwright test that plays it with the synthetic sensor in `e2e/helpers.ts`.
8. **Status:** set `completionStatus: "playable"` and run `pnpm docs:catalogue`. Only the real-device test
   moves a game to `released`.

## Testing with recorded motion

- **Live check:** open `/sensors` on a phone to see live tilt, sample rate, gyroscope availability and every
  detected gesture.
- **Recording:** "Record 10 seconds" downloads a JSON trace.
- **Using a trace:** put real traces in `packages/motion/test/fixtures/` and replay them with `replay(trace)`.
  The synthetic traces in the tests check the maths; real recordings check real phones.
- **Privacy:** only motion readings are recorded, never camera, microphone or location.
