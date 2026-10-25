/**
 * Kitchen Rush (couples, co-op): run a food truck together. Each phone walks one chef; ✋ Grab picks up,
 * puts down, plates up and serves, 🔪 Chop chops on a board. Orders arrive on a ticket rail and run out:
 * chop, cook (don't burn it!), plate and serve before the customers give up. Combos for serving one dish
 * after another, bonuses for passing things over the counter. 6 shifts in 3 worlds; rewards are chef hats
 * and a lantern night sky.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { KitchenSim } from "./sim";

const MENU: ControlSpec["actions"][number]["buttonIn"] = ["buttons", "hybrid", "touchpad"];

export const CONTROLS: ControlSpec = {
  title: "Kitchen Rush",
  modes: ["hybrid", "buttons", "touchpad"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "prev", label: "◀ Prev", swipes: ["swipe-left"], buttonIn: MENU },
    { id: "grab", label: "✋ Grab", color: "#3ee08f", gestures: ["push"], swipes: ["tap"], buttonIn: MENU },
    { id: "chop", label: "🔪 Chop", color: "#ff8a3a", gestures: ["shake"], buttonIn: MENU },
    { id: "next", label: "Next ▶", swipes: ["swipe-right"], buttonIn: MENU },
  ],
  hints: {
    hybrid: "Tilt to walk your chef. ✋ Grab picks up, puts down, plates up and serves. 🔪 Chop at a board",
    buttons: "The joystick walks your chef. ✋ Grab picks up, puts down, plates up and serves. 🔪 Chop at a board",
    touchpad: "Your finger walks your chef, tap to grab. 🔪 Chop at a board",
  },
};

export const KITCHEN: GridTitle = {
  id: "kitchen-rush",
  name: "Kitchen Rush",
  emoji: "🍳",
  coop: true,
  themes: {
    "": "radial-gradient(ellipse at 50% 30%, #3f5a7a 0%, #1b2433 75%)",
    "theme-lanterns": "radial-gradient(ellipse at 50% 10%, #ffb35c 0%, #a0402f 35%, #2a1426 100%)",
  },
  story: { heroSprite: "", heroName: "Mia & Leo", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `${l.recipes.map((r) => ({ salad: "🥗 salads", burger: "🍔 burgers", deluxe: "🍔 deluxe burgers" })[r]).join(", ")} · ${l.round} s shift`,
  })),
  rewards: [
    { stars: 3, id: "hat-red", name: "Red chef hats", kind: "skin", emoji: "🎩" },
    { stars: 7, id: "theme-lanterns", name: "Lantern night", kind: "theme", emoji: "🏮" },
    { stars: 11, id: "hat-gold", name: "Golden chef hats", kind: "skin", emoji: "👑" },
    { stars: 18, id: "trophy-ladle", name: "Golden ladle", kind: "trophy", emoji: "🥄" },
  ],
  controls: CONTROLS,
  menu: { prev: "prev", next: "next", ok: "grab", back: "chop", hint: "◀ Prev / Next ▶ pick a shift, ✋ to play, 🔪 to finish" },
  menuOnly: ["prev", "next"],
  practice: ["grab"],
  create: (level, seed, o) => new KitchenSim(LEVELS[level]!, seed, o.colors, o.quick, o.skin),
};

export function KitchenRushGame(props: GameProps) {
  return <GridShell {...props} title={KITCHEN} />;
}
