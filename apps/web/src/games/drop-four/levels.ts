/**
 * Drop Four opponents: alone you climb this ladder, one opponent per level. With two phones each level is a
 * booth to play each other at.
 *
 *   depth    how many discs ahead they read
 *   blunder  chance of dropping anywhere (they still never miss a win in one)
 *   blind    chance of not noticing you're about to win
 *
 * four.test.ts plays the opponents against each other to check the ladder gets harder.
 */
import type { Brain } from "./rules";

export interface Opponent {
  name: string;
  world: number;
  emoji: string;
  stage: "fair" | "pier" | "bigtop";
  blurb: string;
  brain: Brain;
}

export const LEVELS: Opponent[] = [
  { name: "Benny the Clown", world: 0, emoji: "🤡", stage: "fair", blurb: "Benny drops wherever his honk points", brain: { depth: 1, blunder: 0.5, blind: 0.6 } },
  { name: "Candy Floss Kate", world: 0, emoji: "🍭", stage: "fair", blurb: "Kate blocks if she spots it", brain: { depth: 2, blunder: 0.25, blind: 0.3 } },
  { name: "Old Salt Pete", world: 1, emoji: "🧔", stage: "pier", blurb: "Pete never leaves a three open", brain: { depth: 3, blunder: 0.1, blind: 0 } },
  { name: "Marina", world: 1, emoji: "🧜‍♀️", stage: "pier", blurb: "Marina sets up two threats at once", brain: { depth: 5, blunder: 0.04, blind: 0 } },
  { name: "The Great Zoltan", world: 2, emoji: "🔮", stage: "bigtop", blurb: "Zoltan sees six drops ahead", brain: { depth: 6, blunder: 0, blind: 0 } },
  { name: "Ringmaster Rex", world: 2, emoji: "🎩", stage: "bigtop", blurb: "Rex has never lost under his own tent", brain: { depth: 9, blunder: 0, blind: 0 } },
];

export const WORLDS = [
  {
    name: "World 1 · The Fair",
    text: "The travelling fair is in town, and its best booth is Drop Four: a big wooden rack, a bucket of discs and a prize for anyone who beats the whole crew. Line up four of your discs across, up or slanting to win. Move with ◀ ▶ and tap ✋ to drop.",
  },
  {
    name: "World 2 · The Pier",
    text: "Down on the pier the sea air is salty and the players are sharper. Watch for their threes, and try to make two threats at once: they can only block one.",
  },
  {
    name: "World 3 · The Big Top",
    text: "Under the striped tent, with the whole fair watching, the Great Zoltan and Ringmaster Rex are waiting. The middle column is worth fighting for.",
  },
];
