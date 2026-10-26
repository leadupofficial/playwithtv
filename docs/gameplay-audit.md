# Gameplay audit — October 2026

Read-only code audit of all 36 titles plus the shared lifecycle, with unit-test runs and engine probes.
**Verified** = seen in code, a failing test or a probe. **Suspected** = needs on-screen or real-device play.
No title has been played on a real TV + phone yet (`docs/real-device-test.md` results table is empty).

## Ranked repair plan

| # | Severity | Affects | Issue (evidence) | Fix | Status |
|---|---|---|---|---|---|
| 1 | high | every game | A player who leaves mid-game makes the TV's results invalid: hub rejects them (`apps/server/src/hub.ts` `finish()`), room stays `playing`, TV stuck until the captain exits. Server probe reproduced. | Hub drops departed players from results and re-places the rest | **fixed** + test |
| 2 | high | every game | Phone reconnecting before its old socket closes: hub resets `lastSeq` but never sends `controller.clear`, so the TV's `InputMerger` (`apps/web/src/net/rtc.ts`) drops the new socket's input until its seq passes the old one — controls frozen. Probe reproduced. | Send `controller.clear` to the TV when a phone socket is replaced | **fixed** + test |
| 3 | high | every game | `paused` never becomes true on the TV: no client sends `game.pause`; on TV drop the hub tells only phones. Sim runs while phones show "paused" and hub-relayed input is discarded. | TV pauses itself while its hub socket is down (`TvApp.tsx` `gamePaused`); `tv/pauseGate.ts` holds input during the pause, drops pause-time taps, re-sends each player's latest state on resume; phones say why | **fixed** + tests (unit `rtc.test.ts`, e2e `tv-reconnect.spec.ts`). Captain pause button still todo |
| 4 | critical | Ring Kings Boxing | Jab loop: attacker recovers before the victim's stun ends (`boxing/engine.ts:18,248`). Mirror probe 15–0, victim never lands a punch. CPU mashes GET UP ~33 taps/s (`engine.ts:348`). | Jab hitstun 0.22 → 0.14 s (victim free at 0.26 s, attacker at 0.30 s); CPU taps GET UP 5–8 times a second on its own timer, same at any frame rate | **fixed** + tests (`boxing/engine.test.ts`: no frame advantage, mirror spam is a trade, CPU tap rate at 30/60/120 fps) |
| 5 | high | Gully Super Over | A perfectly timed **motion** swing (120 ms lag) is judged a miss before it arrives (`gully/sim/game.ts:179,203-206`, `shot.ts:24`, `controls.ts:67`). | A ball with no swing yet waits `LATEST_SWING` (0.2 s = motion lag 0.12 + 0.08 jitter) past the late window before it is missed, bowled or kept; a late-arriving swing is judged at the moment it was made | **fixed** + tests (`gully/sim/game.test.ts`: perfect motion swing arriving +0.12/+0.18 s on a stumps ball is perfect contact; a swing truly made 0.15 s late is still bowled) |
| 6 | high | Drop Four, Kings Row | AI search runs synchronously on the render loop: 659 ms / 498 ms worst moves (tests fail under load). Frame hitches on TVs. | Time-sliced search: `thinking()` generators yield every 250/150 positions, sims run ≤ 4 slices a frame (≈2 ms here) starting the moment it is the computer's turn; same picks as the one-shot `think()` (test) | **fixed** + tests (`four.test.ts`, `kings.test.ts`) |
| 7 | high | Kalari Clash | Parry spam: re-pressing guard reopens the 0.15 s parry window with no lockout (`kalari/combat.ts:74,199`); probe 8/14 parries. | `PARRY_LOCKOUT` 0.5 s: a guard press that parries nothing makes presses in the next 0.5 s block only; a successful parry clears it | **fixed** + tests (`kalari/engine.test.ts`: guard mashed 15×/s vs 11 jabs, old 5 parries, now ≤ 25 %; a clean read after the lockout still parries) |
| 8 | high | 4 single-pilot kitgrid games | Pilot disconnect freezes the result screen (`kitgrid/Shell.tsx:31,106,223,239-250`); `back` on the map ends the whole session (Kitchen Rush maps it to Chop/shake). | Hand-off to a connected phone; hold-to-confirm finish; input grace on results | todo |
| 9 | high | Lantern Truths, Mind Match, Two Paths, Tamil Trivia | Card-style read/pick/reveal, static TV; kitcouple stars free, 10-card decks repeat, "pass anything" promised but missing on pick/guess cards, one button does 4 jobs. | Held back: `heldBack` in `packages/protocol/src/catalog.ts`; hub hides/refuses them unless `PREVIEW_GAMES=1` (dev, e2e); listed under "Held back" in `catalogue.md`. Before return: varied decks, earned stars, Pass on every card, real-player test | **held back** + test |
| 10 | high | Squat Rocket | Button reps always "perfect" (0.85 ≥ 0.8); mashing hits max rep rate (`engine.ts:184-192`). | Lower non-camera quality; reset gap on too-fast | todo |
| 11 | high | Tilt Jumper | Rocket chaining doubles score (bot sim 3.2–4.0 km vs 1.7–1.9 km); difficulty saturates at 900 m, half-way through a match. | Rockets skip pickups; stretch the curve | todo |
| 12 | high | Pillow Fort Brawl | 2–4 fps on software GL (CI log); no quality tiers. | Adaptive tier like GHAT RUSH | todo |
| 13 | medium | Beat Blade | Blocks keep flying while paused (`BeatBladeGame.tsx:291`); 3 of 4 lanes count as a hit. | Use `pausedAt`; narrow reach | todo |
| 14 | medium | many | AudioContexts never closed (Memory Wave, Gravity Maze, Sky Gyro); un-cleared finish timeouts (racer, groove, beat-blade). | Close/clear on unmount | todo |
| 15 | medium | catalogue | False claims: Kart/Penalty "tournament" mode, Gravity Maze difficulty + practice, Mind Match e2e. | Implement or remove the claims | todo |

Content/depth (after the above): kitplat levels are ~15–20 s of traversal each with 0 spikes and no fail state;
Lantern Lane ≈ Stepwell Secrets (same powers, foes, boss vocabulary); Sky Gyro Racer is a 34 s AI-less third racer;
every racer/sports title has one difficulty, no cup/championship and no saved progress.

## Flagship bases

- **Turbo Rivals** → GHAT RUSH (3D, drift turbo, CPU that barges, replay, quality governor) + Kart's spline/checkpoint code for real shortcuts. Missing: cup, more courses, vehicle select, difficulty, CPUs that can beat a clean human.
- **Street Fury** → Kalari Clash (frame-data move table, guard/parry, i-frames, best juice stack; `guardians.ts` already runs co-op waves). Fix parry spam first.
- **Monster Mayhem** → Pillow Fort Brawl (percent knockback, ring-outs, hazards, 8 players). Fix performance first.

## Lifecycle coverage gaps (no e2e)

Mid-game leave → finish · phone socket replaced before close · TV drop mid-game · host pause · rematch actually replayed with inputs · exit during finish timeout · dedicated specs for Trivia, Buzz Field, Comet Kitty, Glowworm, Skyline, Mind Match, Two Paths, Lantern Truths.

## Release verification log

**754efd9** (fixes 1–2), full Playwright suite (118 tests):

- CI (GitHub, required check), run on 754efd9: **74 passed, 0 failed, 5 flaky, 39 skipped** (perf, unit and all 4 e2e shards green).
  Flaky (passed on retry): Tiffin Tornado ultra render, wake-lock, Pillow Fort Brawl buttons, Drop Four 2-phone, Gully Super Over buttons.
- Local production-build run on this Mac, alongside an Android emulator and audit agents (load average 11–16):
  **72 passed, 11 failed, 35 skipped, 0 flaky** (no retries locally). Re-running the 11 on their own: 8 passed;
  Gully Super Over buttons then passed 2/2 → **load-flaky**. Two fail every time locally and on a clean checkout of 754efd9,
  yet pass in CI:
  - `showroom.spec.ts:31`: locally high/ultra tiers are also checked, and this headless Chromium has no GPU (lite 3 fps,
    high 1 fps): the ultra screenshot times out. Environment, not 754efd9 (server-only change).
  - `memory.spec.ts:23`: the motion player's 160 ms simulated flick is not counted on this loaded machine (progress stays 0).
    Unresolved: re-check on an idle machine and on a real phone.
- Deployed 754efd9 (`.deployed-commit` = 754efd9, hub healthy). Live checks against https://playwithtv.leadup.in over real
  WebSockets: a player leaving mid-game → TV's results naming them accepted, the rest re-placed (Ana 1, Chitra 1), room → results;
  a phone reconnecting before its old socket closed → TV got `controller.clear` and the new socket's seq-0 input.

**Fixes 3 and 6 + held-back games** (next commit): typecheck clean; unit 58 + 104 + 706 passed; build OK;
e2e `tv-reconnect`, `drop-four`, `kings-row`, `couple`, `smoke-all` 5/5 passed. New tests fail on the old code
(TV clock ran on 35 → 39 s with the hub gone; AI tests: `thinking` missing, no per-frame bound).

**fa7df16** CI (required check): 77 passed, 0 failed, 3 flaky (Drop Four 2-phone, smoke-all, the new tv-reconnect), 39 skipped.
tv-reconnect flaked twice: once its HUD reading was one 150 ms refresh stale (fixed in the test: settle before reading;
12/12 under 4 workers after), once the TV's join code never appeared in CI with the WebSocket routed (passed on retry; not
reproduced locally in 20 runs; watch it).

**Fixes 5, 4, 7**: unit 58 + 104 + 713 passed, typecheck clean, build OK; e2e boxing, kalari-clash, gully-super-over 8 passed,
9 skipped (tier-gated). Each new test failed on the old code (boxing 3, kalari 2, gully 2).

**40c4473** CI: 75 passed, 0 failed, 5 flaky (Tiffin ultra, Pillow Fort buttons, Gully buttons, Tilt Jumper motion,
tv-reconnect), 39 skipped. Deployed (`.deployed-commit` 40c4473, hub healthy); live `/api/games` lists 17 games, none of
the 4 held back.

tv-reconnect's CI flake was the join code never appearing: the routed TV socket's hello went unanswered and the client
waited forever. That is a real gap (any half-open socket strands a TV on "····" or mid-game), so `net.ts` now drops a
socket that hears nothing for `SILENCE_MS` (7 s; pings go every 2 s) and reconnects, ignoring hidden-tab timer throttling.
Tests `net.test.ts` (4; the two silence cases fail on the old client). Memory Wave's two motion/touchpad e2e tests fail
on this Mac with or without the change and pass in CI: still unresolved locally.

**6bb30ba** CI: 76 passed, 0 failed, 4 flaky (Tiffin ultra, tv-reconnect, Beat Blade buttons, Drop Four 2-phone), 39
skipped. Deployed (`.deployed-commit` 6bb30ba, hub healthy).

tv-reconnect still flaked on "····", so an unanswered hello was not the cause. The join code comes from `POST /api/rooms`,
before any socket opens, and `api()` had no timeout: a stalled request (CI's dev proxy, or patchy TV Wi-Fi) left the TV
waiting forever, because its retry runs only on an error. The same "····" timeout appears in each of the last 6 CI runs
(tv-reconnect ×3, wake-lock ×3, Tiffin ultra ×1), always passing on retry; there are no 429s in the logs, so it is not
the per-IP room limit. `api()` now aborts after `API_TIMEOUT_MS` (8 s) with code `timeout`, and the TV retries 5 s
later. Test in `net.test.ts` (fails on the old code: the request never settles). That the stall is the cause is inferred,
not proven: watch the next CI runs for "····".

**8d87410** CI: **failed**: GHAT RUSH 2-phone (`ghat-rush.spec.ts:33`) failed both attempts; flaky: Kart Knockout 2-phone,
Pillow Fort buttons, Gully buttons, Tiffin ultra, tv-reconnect. Not deployed. There were no "····" failures in this run
(the tv-reconnect flake this time was elsewhere).
The GHAT RUSH failure is a real bug: `finish` listed a player twice (7 entries for 6 racers). When a race is called, everyone
still out is placed in `finishOrder` without being marked finished, so one who rolled over the line during the 3 s
results was added again (so: duplicate podium entries, results for a player shown twice). The line now counts only while the
phase is `race` (`ghat/race.ts`). Test `race.test.ts` "not placed twice" (old code: 9 entries). Kart Knockout, Racer and
kitplat checked: each guards its finish already.

**Real devices** (Mi TV AXFU0, Android 14, PlayWithTV app; vivo I2304, Android 16, Chrome) against production:
- TV lobby renders, join code and QR; the phone joins over a direct link (12–24 ms).
- Drop Four vs Benny (L1), a full game on buttons: TV 1,567 frames, median 17 ms, p99 24 ms, 0.57% janky; every tap landed.
- **Bug**: Chrome reopened an old controller tab and showed "Session ended / say hello first" instead of "This room has ended".
  The hub answered the failed hello (`room_not_found`), but left the socket open, so the phone's queued messages each
  drew `unauthorized` "say hello first", and the phone showed the last error. The hub now closes the socket after a hello
  that fails, and the phone keeps the first fatal reason. Test `hub.test.ts` (fails on the old hub).
- Known, seen again: the lobby promo covers the "Join from…" tip.
- Questions for design: a lost Level 1 still scores 260 and offers "► next level".
- Not yet run on the devices: dropping the TV's Wi-Fi (also drops wireless adb), Gully motion swing.

Next: flagship design plans (§4), starting with Pillow Fort Brawl's no-GPU frame rate. Open: games that ignore `paused` (Beat Blade #13) still animate while
input is held; captain pause button; Memory Wave local flick failure.


### Motion on a real phone (vivo I2304, Android 16, Chrome), 2026-10-26

Three recordings from the real phone (a still hold, a 65 s guided routine, and an 84 s routine with on-screen prompts and live gesture readout), replayed through the engine.

- **Fixed: Chrome reports `rotationRate` as alpha = x, beta = y, gamma = z**, not the spec's z, x, y order the adapter assumed. Checked against physics: gravity turning in the phone's frame must equal −ω × g. Chrome's order is off by 0.83, the spec order by 10.2 (across 8 turning windows). Gyro and gravity also agree on steering (right steer: gyro 63°, gravity 83°). Read the old way, twists never fired and saber cuts pointed the wrong way. `RateOrderDetector` (packages/motion/src/axes.ts) now settles the order from gravity on every phone, starting from `xyz` on Android and the spec order on iOS. Tests: test/axes.test.ts uses a real-phone fixture.
- **Changed: the lobby Sensitivity slider (0.5–2×) now also scales every gesture threshold** (push/flick, twist, swing, saber), not just tilt. The same player's moves on this phone peaked at 5–11 m/s² for pushes and 6–8 for swings, against defaults of 11 and 12. At 1× nothing changes.
- **Verified: calibration at rest is clean.** Still phone: calibrated at 0.6 s, zero tilt, zero gestures.
- **Open, not fixed: on this phone pushes often read as pull (production behaviour too).** The detector takes direction from the first sample over the threshold. Real pushes here started with a sharp move towards the player (up to 16 m/s²) or ended with a hard stop (13–16), while the push itself peaked at 10–11. Two fixes were tried on the recordings and rejected: judging along the phone's own axes, and judging by the hand's velocity. Neither turned the recorded pushes into pushes, and it is unknown how the hand actually moved. Affects every game mapping push vs pull (Brawl, Ghat, Kalari, Kitplat, Penalty, Gully, Tiffin). Next: a filmed push test, or a design change (below).
- **Open: steering fast enough fires twists** (they share the axis through the screen: ~250°/s on a return to centre). Harmless unless a game maps both tilt and twist in the same phase.
- **Built (first step of the proposal below): push and pull fold into one action wherever a game maps only one of them** (apps/web/src/phone/gestureMap.ts). Covers Gully bowl/cheer, Penalty kick, Brawl swing, Kitplat act and Tiffin act. A sharp move either way fires the action. Still ambiguous: Kalari (strike vs guard) and Ghat (boost vs item), which map both. A push read as flick-down (1 in 4 on the recording) still misses. Possible side effect: a return movement after a push may fire a second time once the 280 ms cooldown has passed. Not yet verified in a real game.
- **Built: "Practise your move"** (apps/web/src/phone/practice.ts, GamePad). Motion mode only, once per move per visit, after calibration. It never blocks play: the moves still reach the TV (its get-ready screen ticks them off), and the phone shows the practice while it measures. A first version blocked the moves and stalled every motion get-ready screen in e2e; it was never deployed. The player does the game's main move 3 times (15 s limit, skippable) with thresholds lowered 2.5×. Their gain is then set so the threshold sits at 60% of their median move (range 0.5–2.5), saved on the phone, and used instead of the slider for moves. Check against the real recording: the pushes read 1.6–2.6 at practice gain, giving gain ≈1.8 (push threshold 11 → 6.1 m/s²). At that gain every recorded push clears it and the rest-step noise does not. Not yet tried by a player in a real game.
- **Proposal (not built): direction-free "jab"/"swing" for action buttons, keep direction only where it matters.** Fire on "any sharp move" and leave left/right to tilt or on-screen buttons. Swing already works this way and was detected on every recorded swing. Also a 10 s per-player "practice your move" step before motion games: it shows the move it read, sets that player's threshold from their own strength, and replaces a global slider.

### Holding the phone upright (2026-10-26)

Every game was locked to landscape. That is right for two-thumb play (buttons, touchpad, hybrid) and for wheel games (Kart, Racer, Ghat, the platformers). It is wrong for one-handed motion games where the phone is the object and the player watches the TV: Beat Blade says "hold it like a sword hilt" and Gully "like a bat".

`ControlSpec.grip: "any"` (Beat Blade, Gully, Groove Party, Carry Me Home, Gravity Maze; catalog orientation "any") lifts the landscape lock and the rotate prompt in **motion mode only**. Turning the phone round recalibrates, because its screen axes swap. Covered by e2e/grip.spec.ts: upright Beat Blade shows no prompt and recalibrates; switching to buttons brings the prompt back. Upright play has not yet been tried on a real phone.
