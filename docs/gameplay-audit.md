# Gameplay audit — October 2026

Read-only code audit of all 36 titles plus the shared lifecycle, with unit-test runs and engine probes.
**Verified** = seen in code, a failing test or a probe. **Suspected** = needs on-screen or real-device play.
No title has been played on a real TV + phone yet (`docs/real-device-test.md` results table is empty).

## Ranked repair plan

| # | Severity | Affects | Issue (evidence) | Fix | Status |
|---|---|---|---|---|---|
| 1 | high | every game | A player who leaves mid-game makes the TV's results invalid: hub rejects them (`apps/server/src/hub.ts` `finish()`), room stays `playing`, TV stuck until the captain exits. Server probe reproduced. | Hub drops departed players from results and re-places the rest | **fixed** + test |
| 2 | high | every game | Phone reconnecting before its old socket closes: hub resets `lastSeq` but never sends `controller.clear`, so the TV's `InputMerger` (`apps/web/src/net/rtc.ts`) drops the new socket's input until its seq passes the old one — controls frozen. Probe reproduced. | Send `controller.clear` to the TV when a phone socket is replaced | **fixed** + test |
| 3 | high | every game | `paused` never becomes true on the TV: no client sends `game.pause`; on TV drop the hub tells only phones. Sim runs while phones show "paused" and hub-relayed input is discarded. | TV pauses itself on socket close; captain pause button | todo |
| 4 | critical | Ring Kings Boxing | Jab loop: attacker recovers before the victim's stun ends (`boxing/engine.ts:18,248`). Mirror probe 15–0, victim never lands a punch. CPU mashes GET UP ~33 taps/s (`engine.ts:348`). | Shorter jab hitstun / pushback; human-rate CPU mash; frame-advantage tests | todo |
| 5 | high | Gully Super Over | A perfectly timed **motion** swing (120 ms lag) is judged a miss before it arrives (`gully/sim/game.ts:179,203-206`, `shot.ts:24`, `controls.ts:67`). | Settle miss/bowled after late window + max lag | todo |
| 6 | high | Drop Four, Kings Row | AI search runs synchronously on the render loop: 659 ms / 498 ms worst moves (tests fail under load). Frame hitches on TVs. | Web Worker or time-sliced search with wall-clock cap | todo |
| 7 | high | Kalari Clash | Parry spam: re-pressing guard reopens the 0.15 s parry window with no lockout (`kalari/combat.ts:74,199`); probe 8/14 parries. | Parry lockout after a whiffed guard press | todo |
| 8 | high | 4 single-pilot kitgrid games | Pilot disconnect freezes the result screen (`kitgrid/Shell.tsx:31,106,223,239-250`); `back` on the map ends the whole session (Kitchen Rush maps it to Chop/shake). | Hand-off to a connected phone; hold-to-confirm finish; input grace on results | todo |
| 9 | high | Lantern Truths, Mind Match, Two Paths, Tamil Trivia | Card-style read/pick/reveal, static TV; kitcouple stars free, 10-card decks repeat, "pass anything" promised but missing on pick/guess cards, one button does 4 jobs. | **Hide from the live catalogue** (product-owner call) | needs decision |
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
