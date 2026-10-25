/**
 * Lantern Truths (couples truth-or-dare in the spirit of the classic party game): take turns opening a floating
 * lantern and choose its truth or its dare. Doing one fills the heart meter; passing is always fine.
 * Five chapters (First Date, Road Trip, Rainy Night In, Anniversary, and the optional 18+ After Dark), 3 stars
 * each, rewards at 3/6/9/12 stars. The cards live in deck.ts so anyone can add more without touching code.
 */
import type { GameProps } from "../types";
import { CoupleShell } from "../kitcouple/Shell";
import type { CoupleTitle } from "../kitcouple/engine";
import { DECK } from "./deck";

export const LANTERN_TRUTHS: CoupleTitle = {
  id: "lantern-truths",
  name: "Lantern Truths",
  emoji: "🏮",
  tagline: "Take turns opening floating lanterns. Each holds a truth and a dare. Passing is always fine.",
  howTo: "On your turn, pick Truth or Dare on your phone. Either of you taps ✅ when it's done, or 🙅 to pass. Passing costs nothing.",
  cards: DECK,
  stories: [
    "A lantern festival on the river. Each lantern you open holds a sweet little truth or a gentle dare.",
    "A road-side fair with lanterns strung between the stalls. The dares get goofier and the truths get funnier.",
    "Rain on the roof and one lantern glowing on the table. Honest truths and caring dares, at your own pace.",
    "Your anniversary, and the sky is full of lanterns from every chapter. Open them together.",
    "Red lanterns after midnight, adults only. Flirty truths and affectionate dares. Pass anything you like.",
  ],
  rewards: [
    { stars: 3, id: "theme-river", name: "River Glow", kind: "theme", emoji: "🌊" },
    { stars: 6, id: "trophy-lantern", name: "First Lantern", kind: "trophy", emoji: "🏮" },
    { stars: 9, id: "theme-sky", name: "Lantern Sky", kind: "theme", emoji: "🌌" },
    { stars: 12, id: "trophy-festival", name: "Festival Hearts", kind: "trophy", emoji: "💖" },
  ],
  themes: {
    "": "linear-gradient(170deg, #2a1f5b 0%, #7a3f8a 55%, #e08a4d 100%)",
    "theme-river": "linear-gradient(170deg, #12355b 0%, #2f6f8a 50%, #e0b04d 100%)",
    "theme-sky": "linear-gradient(170deg, #0d1033 0%, #3a2a7a 50%, #ff9a5b 100%)",
  },
};

export function LanternTruthsGame(props: GameProps) {
  return <CoupleShell {...props} title={LANTERN_TRUTHS} />;
}
