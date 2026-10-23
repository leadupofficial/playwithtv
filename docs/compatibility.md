# Compatibility matrix

**Only what was actually run is marked as verified.** Everything else is expected or unknown until someone
tests it; add rows from real-device runs ([real-device-test.md](real-device-test.md)).

## TVs (game display)

| Device | Engine | Lobby | Trivia / Boxing (2D) | Maze / Racer (3D, WebGL) | How verified |
|---|---|---|---|---|---|
| Xiaomi MiTV-AXFU0, Google TV, Android 14, 1 GB RAM (WebView Chrome 155, WebGL2, Mali-G31, 961×541 @1.33) | Android System WebView (TV app) | ✅ verified | ✅ boxing / trivia played earlier | ✅ verified 2026-10-24: racer 60 fps (split screen); maze 60 fps in lite mode (was ~42 fps with full shadows + MSAA) | real screen captures over ADB; fps measured in-page via WebView DevTools, scripted phone on the live site |
| Desktop Chromium 1280×720 (Playwright) | Chromium | ✅ | ✅ | ✅ | automated e2e |
| Samsung Tizen 2022+ (Chromium M85+) | built-in browser | expected | expected | expected (WebGL1/2) | untested |
| Samsung Tizen 2017–2021 (M47–M76) | built-in browser | ❌ until the legacy build exists | ❌ | ❌ | the current build targets ES2020 / Chromium 80 |
| LG webOS 6+ | built-in browser | expected | expected | expected | untested |
| Fire TV (Silk / TV app sideloaded) | Chromium / WebView | expected | expected | expected | untested |

## Phones (motion controller)

| Phone / browser | Motion API | Gyroscope | Status |
|---|---|---|---|
| Android Chrome (https) | DeviceMotion, no prompt | usually | expected; **real hand-held test pending** |
| iPhone Safari (https) | DeviceMotion after a tap + permission prompt | yes | expected; untested |
| Emulated Pixel 7 landscape (Playwright, synthetic sensor) | DeviceMotion | synthetic | ✅ automated e2e |
| Any browser over plain http | blocked by the browser | – | shows "can't read motion sensors" |
| Desktop browsers | no motion sensors | – | shows "can't read motion sensors" |

## Known limits

- Motion needs a secure page (https). The production site and the LAN dev server (`HTTPS=1`) both provide it.
- Backgrounding the browser pauses sensors. The phone releases its tilt, and on return it recalibrates.
- 3D games load three.js only when started: 143 KB gzipped (568 KB raw) once, plus about 5 KB per game. The lobby bundle is 156 KB gzipped.
- Lite rendering: TVs reporting ≤ 2 GB memory (`navigator.deviceMemory`) get no MSAA, cheaper shading and fewer shadows in 3D games.
- Direct phone→TV links need both on the same network and a router that allows device-to-device traffic
  (guest or "AP isolation" Wi-Fi blocks it). Otherwise input falls back to the server automatically.
  Verified: Mac Chromium and a real phone ("Abi") → Xiaomi TV WebView, direct, 7–9 ms round trip.
- Rooms hold at most 8 players. Games planned for larger groups are capped at 8 until tested.
