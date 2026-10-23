# Real-device controller acceptance test

The roadmap's gate: the catalogue does not expand until this passes on real phones and a real TV. Automated
tests use a synthetic sensor, so they cannot answer "does it feel right in the hand?". This checklist does.

Record each run in the table at the bottom: phone model, browser, TV, date, and pass/fail per step, with notes.

## Setup (touch allowed)

1. On the TV, open the TV app or `https://playwithtv.leadup.in/tv`.
2. Scan the QR with the phone; it opens in Chrome or Safari over https.
3. Join, tap "Tap to start your controller", allow motion (iPhone shows a prompt), turn the phone sideways.
4. **Sensor check:** open `/sensors` on the same phone.
   - Roll and pitch should follow the phone smoothly.
   - Samples per second should be 50 or more.
   - A gentle push towards the TV should show `push` exactly once.

## During play (no touching the screen)

| # | Check | Pass when |
|---|---|---|
| 1 | Auto-calibration | The phone shows "Ready!" within 2 s of holding still; the TV's practice card shows ✓ |
| 2 | Practice | Each practice gesture ticks on the TV the first time it is done gently |
| 3 | No false triggers | Holding still, talking, sitting back for 30 s fires no gestures |
| 4 | One move, one action | Ten separate pushes give ten actions, never double |
| 5 | Trivia | Turning moves your marker across all four answers; a push locks the one under it |
| 6 | Boxing | Push jabs, flick sideways hooks, flick up uppercuts, tip back guards; shaking gets you up |
| 7 | Maze | With the phone flat, tilting rolls the ball where you expect; level phone = still ball |
| 8 | Racer | Steering feels proportional; tip away dives; push boosts once |
| 9 | Latency | Movement shows on the TV fast enough to steer (note the ms chip on the phone) |
| 10 | Re-centre | After shifting position, "Re-centre" makes the new hold neutral |
| 11 | Interruptions | Lock the phone mid-game, unlock: it reconnects and works again after recalibrating |
| 12 | Two players | Two phones at once never control each other's player |
| 13 | Finish & replay | Match ends, results on TV, Rematch works without touching the phones |

## Results log

| Date | Phone / OS / browser | TV | Steps passed | Notes (thresholds, sensitivity used, issues) |
|---|---|---|---|---|
| | | | | |
