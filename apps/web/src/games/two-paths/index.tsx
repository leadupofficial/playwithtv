/**
 * Two Paths (couples, "this or that" in the spirit of the classic would-you-rather party game): two
 * travellers at a fork in the road pick a path in secret on their phones; when the paths match, the heart
 * meter fills.
 * Five chapters (First Date, Road Trip, Rainy Night In, Anniversary, and the optional 18+ After Dark), 3 stars
 * each, rewards at 3/6/9/12 stars. The cards live in deck.ts so anyone can add more without touching code.
 */
import type { GameProps } from "../types";
import { CoupleShell } from "../kitcouple/Shell";
import type { CoupleTitle } from "../kitcouple/engine";
import { DECK } from "./deck";

export const TWO_PATHS: CoupleTitle = {
  id: "two-paths",
  name: "Two Paths",
  emoji: "🛤️",
  tagline: "Two travellers, one road. Pick your paths in secret and see how often they meet.",
  howTo: "Each card has two paths. Pick yours in secret on your phone. When you both pick the same one, the heart meter fills.",
  cards: DECK,
  stories: [
    "You meet at a crossroads lit by fairy lights. Every signpost asks a question. Choose a path, and see if your partner walks the same way.",
    "The car is packed, the map is upside down and the snacks are already gone. Pick the silly paths and find out how in tune you really are.",
    "Rain taps on the window. Blankets, tea, and the kind of questions you only ask on quiet nights. There are no wrong paths here, only talking.",
    "A year of paths, all leading here. The road is lined with lanterns from every chapter. One last walk together through all your favourite questions.",
    "The streetlights dim and the road winds somewhere warmer. Flirty choices for grown-up travellers. Pick boldly, or pass, it's up to you.",
  ],
  rewards: [
    { stars: 3, id: "theme-dusk", name: "Dusky Road", kind: "theme", emoji: "🌆" },
    { stars: 6, id: "trophy-compass", name: "Shared Compass", kind: "trophy", emoji: "🧭" },
    { stars: 9, id: "theme-meadow", name: "Wildflower Way", kind: "theme", emoji: "🌼" },
    { stars: 12, id: "trophy-map", name: "Our Map", kind: "trophy", emoji: "🗺️" },
  ],
  themes: {
    "": "linear-gradient(160deg, #ff8a8a 0%, #b15cd6 55%, #4b3fa8 100%)",
    "theme-dusk": "linear-gradient(160deg, #ffb36b 0%, #e0607e 50%, #3a2a6b 100%)",
    "theme-meadow": "linear-gradient(160deg, #8fd3a0 0%, #3fae8a 50%, #2a5d6b 100%)",
  },
};

export function TwoPathsGame(props: GameProps) {
  return <CoupleShell {...props} title={TWO_PATHS} />;
}
