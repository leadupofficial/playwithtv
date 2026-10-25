# Couples games

Three games for two phones on one TV, built on one shared engine (`apps/web/src/games/kitcouple`):

| Classic | Our title | How it plays |
|---|---|---|
| Would You Rather | **Two Paths** 🛤️ | Both partners secretly pick one of two paths; matching picks fill the heart meter |
| Quiz battle (newlywed-style) | **Mind Match** 🧠 | One partner answers about themselves in secret, the other guesses; right guesses fill the meter |
| Truth or Dare | **Lantern Truths** 🏮 | Take turns opening a lantern and choosing its truth or its dare; doing it fills the meter, passing is free |

## The journey (levels)

Every title follows the same five chapters, each with its own story card per game:

| # | Chapter | Deck | Opens |
|---|---|---|---|
| 1 | 🌹 First Date | sweet | always |
| 2 | 🚗 Road Trip | silly | with a star in chapter 1 |
| 3 | 🌧️ Rainy Night In | deep | with a star in chapter 2 |
| 4 | 🥂 Anniversary | sweet + silly + deep | with a star in chapter 3 |
| 5 | 🌶️ After Dark | spicy (18+) | optional, behind the age check |

A chapter deals 8 cards (2 with `?quick=1`), taking turns, without repeating a card within a session until the
deck runs out.

## Rewards

Three stars per chapter, 12 in total from the four main chapters. Stars come from playing every card and from
filling the heart meter (half, then three quarters). In Lantern Truths they come from both partners completing a card and from
completing at least one truth and one dare. Each title unlocks two themes and two trophies, at 3, 6, 9 and 12 stars.
Progress is kept on the TV (`localStorage`, `pwtv.grid.<id>`), like the single-player games.

## Sweet by default, Spicy opt-in

- **Default is Sweet.** Chapters 1–4 are romantic, silly or heartfelt: safe for any audience.
- **After Dark (18+)** is listed with an "18+ · optional" tag but never opens without a check: **both** players confirm
  "I'm 18+" on their own phones. Either one tapping "Not for us" closes it. The confirmation lasts for that match
  only and is never saved. It's asked again every time.
- **After Dark is a bonus.** It never counts towards stars or rewards, and "▶ Next" never moves into it, so
  nobody has to play it to finish a game.
- **Spicy means flirty, never explicit.** Compliments, kisses on the hand or cheek, slow dances, massages, whispered
  flirting. No nudity, no sexual acts, nothing that needs props or leaving the room.
- **Consent is in the rules, and tested.** Either partner can pass any truth or dare, any time. Passing costs nothing and never removes
  a star. Picks are secret: the TV shows a 🔒 until both are in.
- The manifest flags these games `matureOptIn: true`, so a store listing or a parental filter can find them.

## Adding cards (no code needed)

Each game's cards are in plain lists: `two-paths/deck.ts`, `mind-match/deck.ts`, `lantern-truths/deck.ts`.
Copy a line, change the words, pick a tone (`sweet`, `silly`, `deep`, `spicy`). `{S}` is the subject's name and `{P}`
the partner's. Keep phone options short (about 26 characters). The unit tests (`kitcouple.test.ts`) check that:

- every chapter has enough cards
- spicy cards never reach the sweet chapters
- text is English, with no duplicates
- every reward can be earned without After Dark

Spicy cards need a maintainer's review before they're merged (see "Spicy means flirty, never explicit" above).

## Still to come: camera couples games

**Mirror Me**, **Heart Frame**, **Partner Pulse** and **Slow Sway** reuse the camera body tracking from Squat Rocket,
where the propped-up phone tracks the players and the video never leaves the phone. They come after its failing camera e2e test is fixed.
