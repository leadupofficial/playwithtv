/**
 * Drop Four (two-player, board game): four in a row at the travelling fair. Alone, beat six booth keepers from
 * the fair to the Big Top; with two phones, play each other (sides swap every game). ◀ ▶ moves your disc, ✋
 * drops it, ↩ twice resigns. Rules and computer player written from scratch (rules.ts).
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { FourSim } from "./sim";

const ALL: ControlSpec["actions"][number]["buttonIn"] = ["buttons", "hybrid", "touchpad"];

export const CONTROLS: ControlSpec = {
  title: "Drop Four",
  modes: ["buttons", "touchpad", "hybrid"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [
    { id: "prev", label: "◀ Prev", swipes: ["swipe-left"], buttonIn: ALL },
    { id: "drop", label: "✋ Drop", color: "#ffd23f", gestures: ["push"], swipes: ["tap"], buttonIn: ALL },
    { id: "next", label: "Next ▶", swipes: ["swipe-right"], buttonIn: ALL },
    { id: "back", label: "↩ Back", swipes: ["swipe-down"], buttonIn: ALL },
  ],
  hints: {
    buttons: "◀ ▶ move your disc over the rack, ✋ drops it. Four in a row wins!",
    touchpad: "Slide left and right to move your disc, tap to drop it",
    hybrid: "Tilt left and right to move your disc, ✋ drops it",
  },
};

const STAGE = { fair: "Fair booth", pier: "Pier booth", bigtop: "Big Top booth" };

export const FOUR: GridTitle = {
  id: "drop-four",
  name: "Drop Four",
  emoji: "🔴",
  versus: true,
  themes: {
    "": "linear-gradient(#3b2a5c, #1f1633)",
    "theme-bigtop": "linear-gradient(#7a1f2a, #2a0d12)",
  },
  story: { heroSprite: "", heroName: "The fair crew", worlds: WORLDS },
  levels: LEVELS.map((o, i) => {
    const table = `${STAGE[o.stage]} ${(i % 2) + 1}`;
    return { name: `${o.emoji} ${o.name}`, world: o.world, table, brief: `${o.blurb}. With two phones: play each other at the ${table}` };
  }),
  rewards: [
    { stars: 3, id: "discs-glow", name: "Glow discs", kind: "skin", emoji: "💡" },
    { stars: 7, id: "theme-bigtop", name: "Big Top night", kind: "theme", emoji: "🎪" },
    { stars: 12, id: "trophy-teddy", name: "Giant teddy", kind: "trophy", emoji: "🧸" },
    { stars: 18, id: "trophy-four", name: "Ringmaster's hat", kind: "trophy", emoji: "🎩" },
  ],
  controls: CONTROLS,
  menu: { prev: "prev", next: "next", ok: "drop", back: "back", hint: "◀ Prev / Next ▶ pick an opponent, ✋ to play" },
  menuOnly: ["prev", "next"],
  practice: ["drop"],
  create: (level, seed, o) => new FourSim(LEVELS[level]!, seed, o.skin, o.colors, o.names, o.quick),
};

export function DropFourGame(props: GameProps) {
  return <GridShell {...props} title={FOUR} />;
}
