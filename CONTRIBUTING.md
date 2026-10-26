# Contributing to Play With TV

Thanks for helping! The goal is **100+ games that run smoothly on a cheap Android TV**, built by a community of
coders and non-coders alike. This page explains how to get a change merged.

## Ways to help

| Skill | What you can do |
|---|---|
| None needed | Play on your phone and TV and report what felt wrong ([real-device-test.md](docs/real-device-test.md)) |
| Writing | Trivia packs in `content/trivia/` (check them with `pnpm content:check`), game stories, level names |
| Music / dance | Songs and dance routines are plain text: see the comments at the top of `games/beat-blade/songs.ts` and `games/groove/routine.ts` |
| Art | Blender scripts in `tools/blender/`; everything must be original or CC0 and listed in [ASSETS.md](ASSETS.md) |
| Code | New games ([docs/building-games.md](docs/building-games.md)), bug fixes, performance work |

## Before you start

- For anything bigger than a small fix, **open an issue first** so we can agree on the idea before you build it.
- Game ideas: check [docs/catalogue.md](docs/catalogue.md); many concepts are listed and waiting for a builder.

## Set up

```bash
corepack enable && pnpm install
pnpm hooks:install      # blocks commits that contain secrets (needs gitleaks: brew install gitleaks)
pnpm dev                # TV: http://localhost:5173/tv · phone: http://localhost:5173/join
```

To test with real phones and motion sensors on your Wi-Fi: `sh scripts/start-lan.sh` (see the README).

## The rules every pull request must pass

CI runs all of these. Run them yourself first:

```bash
pnpm typecheck && pnpm test && pnpm build
pnpm e2e        # at least the spec for the game you changed: pnpm e2e e2e/<game>.spec.ts
```

1. **Weak TVs come first.** A game must hold its frame budget ([docs/performance.md](docs/performance.md)) on the
   `lite` quality tier. No per-frame allocations in hot loops, no huge textures, lazy-load anything heavy.
2. **Every game plays with buttons**, not only motion or camera.
3. **Rules are a pure, tested module** (no DOM): physics and scoring live in `engine.ts` with a Vitest file.
4. **An end-to-end test** drives the game with simulated phones (`e2e/helpers.ts` has fake motion sensors).
5. **Original or CC0 assets only.** No commercial songs, characters, logos or ripped sprites. Music is synthesised in code.
6. **English text**, family-friendly by default. Adult content must be opt-in and age-gated, like the couples decks.
7. **The server stays light.** Games run on the TV; don't add server work per frame or per input.
8. **Privacy:** camera frames never leave the phone; never log names or IDs beyond what already exists.
9. **No secrets** in code, tests or screenshots. Configuration goes through environment variables (`.env.example`).

## Pull requests

- Keep each PR to one game or one fix. Explain *what* and *why*, and add screenshots or a short clip for visual changes.
- Changes to the server, protocol, security-sensitive code and CI need a maintainer's review (see `.github/CODEOWNERS`).
- By contributing you agree your work is released under the [MIT licence](LICENSE)
  (or, for content, the licence named in [ASSETS.md](ASSETS.md)).

## Code style

TypeScript strict mode. Match the code around you: small modules, plain names, comments that explain *why*.
Changes to a shared shell (for example `games/kitgrid/Shell.tsx`) must pass e2e for **every** game that uses it.

Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).
