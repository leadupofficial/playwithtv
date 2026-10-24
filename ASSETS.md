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
