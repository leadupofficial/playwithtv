/**
 * Kings Row (two-player, board game): classic draughts on the TV. Alone, climb a ladder of six park, café
 * and Grand Hall opponents; with two phones, play each other (sides swap every game). Arrows move your
 * cursor, ✋ picks a piece up and puts it down, ↩ puts it back (twice: resign). Rules engine and computer
 * player are written from scratch (rules.ts).
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { KingsSim } from "./sim";

const ALL: ControlSpec["actions"][number]["buttonIn"] = ["buttons", "hybrid", "touchpad"];

export const CONTROLS: ControlSpec = {
  title: "Kings Row",
  modes: ["buttons", "touchpad", "hybrid"],
  stick: "arrows",
  tilt: "aim",
  actions: [
    { id: "prev", label: "◀ Prev", swipes: ["swipe-left"], buttonIn: ALL },
    { id: "pick", label: "✋ Pick", color: "#ffd23f", gestures: ["push"], swipes: ["tap"], buttonIn: ALL },
    { id: "next", label: "Next ▶", swipes: ["swipe-right"], buttonIn: ALL },
    { id: "back", label: "↩ Back", swipes: ["swipe-down"], buttonIn: ALL },
  ],
  hints: {
    buttons: "Arrows move your cursor. ✋ picks a piece up, ✋ again puts it down. ↩ puts it back",
    touchpad: "Slide your finger to move the cursor, tap to pick up and put down. Swipe down to put it back",
    hybrid: "Tilt to move the cursor, ✋ picks up and puts down, ↩ puts it back",
  },
};

export const KINGS: GridTitle = {
  id: "kings-row",
  name: "Kings Row",
  emoji: "♟️",
  versus: true,
  themes: {
    "": "linear-gradient(#2f4a2a, #1d2e1a)",
    "theme-hall": "linear-gradient(#2a1f3a, #120d1c)",
  },
  story: { heroSprite: "", heroName: "The Kings Row club", worlds: WORLDS },
  levels: LEVELS.map((o) => ({ name: `${o.emoji} ${o.name}`, world: o.world, brief: `${o.blurb}. With two phones: play each other at the ${o.table === "park" ? "park table" : o.table === "cafe" ? "café table" : "Grand Hall table"}` })),
  rewards: [
    { stars: 3, id: "pieces-marble", name: "Marble pieces", kind: "skin", emoji: "⚪" },
    { stars: 7, id: "theme-hall", name: "Grand Hall night", kind: "theme", emoji: "🏛️" },
    { stars: 11, id: "kings-gold", name: "Golden crowns", kind: "skin", emoji: "👑" },
    { stars: 18, id: "trophy-kings", name: "Champion's cup", kind: "trophy", emoji: "🏆" },
  ],
  controls: CONTROLS,
  menu: { prev: "prev", next: "next", ok: "pick", back: "back", hint: "◀ Prev / Next ▶ pick an opponent, ✋ to play" },
  menuOnly: ["prev", "next"],
  practice: ["pick"],
  create: (level, seed, o) => new KingsSim(LEVELS[level]!, seed, o.skin, o.colors, o.names, o.quick),
};

export function KingsRowGame(props: GameProps) {
  return <GridShell {...props} title={KINGS} />;
}
