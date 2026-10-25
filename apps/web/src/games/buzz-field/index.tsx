/**
 * Buzz Field (single-player, hidden-hive logic puzzle in the spirit of the classic mine-finder): help
 * Beekeeper Bea mow the meadow for the Summer Fair without waking a hive. 10 meadows in 3 worlds; stars for
 * clearing, beating the clock and flagging every hive with a clean run; rewards are garden trophies and a
 * golden-hour theme.
 */
import type { ControlAction } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import { dirControls } from "../kitgrid/controls";
import type { GridTitle } from "../kitgrid/types";
import { FieldSim, LEVELS, WORLDS } from "./sim";

const ACTIONS: ControlAction[] = [
  { id: "dig", label: "🌱 Mow", color: "#3ee08f", gestures: ["push"], swipes: ["tap"], buttonIn: ["buttons", "hybrid", "touchpad"] },
  { id: "flag", label: "🚩 Flag", color: "#ff5d5d", gestures: ["twist-left", "twist-right"], buttonIn: ["buttons", "hybrid", "touchpad"] },
];

const base = dirControls("Buzz Field", "move", ACTIONS);
export const CONTROLS = {
  ...base,
  hints: {
    buttons: "Arrows move, 🌱 mows the patch, 🚩 marks a hive",
    touchpad: "Swipe to move, tap to mow, 🚩 marks a hive",
    motion: "Flick to move, push to mow, twist to flag a hive",
  },
};

export const BUZZ_FIELD: GridTitle = {
  id: "buzz-field",
  name: "Buzz Field",
  emoji: "🐝",
  themes: {
    "": "linear-gradient(180deg, #8fd3ff 0%, #c8f0a8 70%, #7cc262 100%)",
    "theme-golden": "linear-gradient(180deg, #ffb36b 0%, #ffd98a 55%, #b4c95a 100%)",
  },
  story: { heroSprite: "bea", heroName: "Bea", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `${l.w} × ${l.h} meadow · ${l.hives} hives · ${l.jars ? `${l.jars} honey jar${l.jars > 1 ? "s" : ""}` : "no honey jars!"} · ★ ${l.par} s`,
  })),
  rewards: [
    { stars: 4, id: "trophy-ribbon", name: "Blue Ribbon", kind: "trophy", emoji: "🎀" },
    { stars: 10, id: "theme-golden", name: "Golden Hour", kind: "theme", emoji: "🌅" },
    { stars: 18, id: "trophy-jar", name: "Honey Pot", kind: "trophy", emoji: "🍯" },
    { stars: 30, id: "trophy-queen", name: "Friend of the Queen", kind: "trophy", sprite: "bee" },
  ],
  controls: CONTROLS,
  menu: { prev: "left", next: "right", ok: "dig", back: "flag", hint: "◀ ▶ pick a meadow, 🌱 play, 🚩 finish" },
  practice: ["right", "down", "dig", "flag"],
  create: (level, seed, o) => new FieldSim(LEVELS[level]!, level, seed, o.quick),
};

export function BuzzFieldGame(props: GameProps) {
  return <GridShell {...props} title={BUZZ_FIELD} />;
}
