/**
 * Kings Row opponents. Playing alone you climb this ladder, one opponent per level. With two phones, each
 * level is just a table to play each other at (the opponent sits it out).
 *
 *   depth    how many moves ahead they read (1 = only this move, 7 = sharp)
 *   blunder  chance of playing any old move instead of thinking
 *   noise    how sloppy their judgement is (score points of randomness)
 *
 * kings.test.ts plays each opponent against the one below it to check the ladder gets harder.
 */
import type { Brain } from "./rules";

export interface Opponent {
  name: string;
  world: number;
  emoji: string;
  /** Where you play them (and the table colours). */
  table: "park" | "cafe" | "hall";
  blurb: string;
  brain: Brain;
}

export const LEVELS: Opponent[] = [
  { name: "Milo", world: 0, emoji: "🧒", table: "park", blurb: "Milo is eight and plays fast and loose", brain: { depth: 1, blunder: 0.5, noise: 60 } },
  { name: "Auntie Rosa", world: 0, emoji: "👵", table: "park", blurb: "Rosa never misses a free piece", brain: { depth: 2, blunder: 0.2, noise: 35 } },
  { name: "Professor Bram", world: 1, emoji: "🧑‍🏫", table: "cafe", blurb: "Bram thinks a few moves ahead", brain: { depth: 3, blunder: 0.08, noise: 20 } },
  { name: "Lin & Lou", world: 1, emoji: "👯", table: "cafe", blurb: "The twins set traps for each other, and for you", brain: { depth: 4, blunder: 0.04, noise: 12 } },
  { name: "Captain Ines", world: 2, emoji: "👩‍✈️", table: "hall", blurb: "Ines guards her back row like a fortress", brain: { depth: 5, blunder: 0.01, noise: 6 } },
  { name: "Grandmaster Ada", world: 2, emoji: "👑", table: "hall", blurb: "Ada has been champion for thirty years", brain: { depth: 7, blunder: 0, noise: 2 } },
];

export const WORLDS = [
  {
    name: "World 1 · The Park",
    text: "Every Sunday the old stone tables in Kings Row Park fill up with draughts players. Win your way up from the park benches to the Grand Hall and take on Grandmaster Ada. Move your cursor with the arrows, tap ✋ to pick up a piece and ✋ again where it should go. If you can jump an enemy piece, you must!",
  },
  {
    name: "World 2 · The Café Club",
    text: "Word gets around: the café club wants to see you play. The tables are tight, the coffee is strong, and these players think a few moves ahead. Get a man to the far row to crown a king that moves both ways.",
  },
  {
    name: "World 3 · The Grand Hall",
    text: "Chandeliers, a hushed crowd, and the two best players in town. Keep your back row safe, trade when you're ahead, and never leave a piece hanging.",
  },
];
