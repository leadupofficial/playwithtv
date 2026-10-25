/**
 * Mind Match (couples quiz battle in the spirit of the classic newlywed game show): one partner answers about
 * themselves in secret, the other guesses; right guesses fill the heart meter. Turns alternate.
 * Five chapters (First Date, Road Trip, Rainy Night In, Anniversary, and the optional 18+ After Dark), 3 stars
 * each, rewards at 3/6/9/12 stars. The cards live in deck.ts so anyone can add more without touching code.
 */
import type { GameProps } from "../types";
import { CoupleShell } from "../kitcouple/Shell";
import type { CoupleTitle } from "../kitcouple/engine";
import { DECK } from "./deck";

export const MIND_MATCH: CoupleTitle = {
  id: "mind-match",
  name: "Mind Match",
  emoji: "🧠",
  tagline: "How well do you know each other? One answers, one guesses, the heart meter keeps score.",
  howTo: "One of you answers honestly about yourself, the other guesses. Both pick in secret. A right guess fills the heart meter.",
  cards: DECK,
  stories: [
    "Welcome to the Mind Match studio! Tonight's contestants: the two of you. Round one is about first impressions and little things.",
    "The studio lights flash and the questions get sillier. Habits, snacks, karaoke. How much do you really know?",
    "The audience goes quiet and the lights go soft. Dreams, fears and what you value most. Take your time.",
    "The grand final! Questions from every round, confetti on standby. Prove you're the couple who knows each other best.",
    "The late-night edition, adults only. Flirty questions about attraction and romance. Answer honestly, or pass.",
  ],
  rewards: [
    { stars: 3, id: "theme-studio", name: "Studio Lights", kind: "theme", emoji: "💡" },
    { stars: 6, id: "trophy-buzzer", name: "Golden Buzzer", kind: "trophy", emoji: "🔔" },
    { stars: 9, id: "theme-neon", name: "Neon Stage", kind: "theme", emoji: "🌃" },
    { stars: 12, id: "trophy-crown", name: "Mind Readers", kind: "trophy", emoji: "👑" },
  ],
  themes: {
    "": "linear-gradient(160deg, #5b8def 0%, #8a5bd6 55%, #d65b9a 100%)",
    "theme-studio": "linear-gradient(160deg, #ffcf5b 0%, #f08a3c 50%, #8a2f5b 100%)",
    "theme-neon": "linear-gradient(160deg, #1fd1c1 0%, #5b4bd6 50%, #d63fa8 100%)",
  },
};

export function MindMatchGame(props: GameProps) {
  return <CoupleShell {...props} title={MIND_MATCH} />;
}
