/**
 * Carry Me Home (couples, co-op): two players carry one sofa to their new home. Each phone holds one end:
 * walk together, pivot round corners, cross busy streets and squeeze through garden gates.
 * 8 levels in 3 worlds; stars for delivering, few wall scrapes and a quick trip; rewards are new sofas
 * and a sunset sky.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { CarrySim } from "./sim";

export const CONTROLS: ControlSpec = {
  title: "Carry Me Home",
  modes: ["motion", "buttons", "touchpad"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "prev", label: "◀ Prev", gestures: ["flick-left"], swipes: ["swipe-left"] },
    { id: "ok", label: "▶ Go", gestures: ["flick-up"], swipes: ["swipe-up"] },
    { id: "back", label: "✓ Done", gestures: ["flick-down"], swipes: ["swipe-down"] },
    { id: "next", label: "Next ▶", gestures: ["flick-right"], swipes: ["swipe-right"] },
  ],
  hints: {
    motion: "Hold the phone flat like a tray and tilt it the way you want to walk. Your partner holds the other end!",
    buttons: "The joystick walks your end of the sofa. Move together, or pivot round your partner to turn",
    touchpad: "Your finger walks your end of the sofa. Move together, or pivot round your partner to turn",
  },
};

export const CARRY: GridTitle = {
  id: "carry-home",
  name: "Carry Me Home",
  emoji: "🛋️",
  coop: true,
  themes: {
    "": "radial-gradient(ellipse at 50% 30%, #6b4a7a 0%, #2a1c33 75%)",
    "theme-sunset": "linear-gradient(180deg, #ff9a6b 0%, #c2507a 45%, #3a1f4a 100%)",
  },
  story: { heroSprite: "", heroName: "The sofa", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `Carry the sofa home · ${l.cars ? "cross the roads between the cars" : "mind the walls"}${l.map.some((r) => r.includes("g")) ? " · gates open on a beat" : ""}`,
  })),
  rewards: [
    { stars: 4, id: "sofa-velvet", name: "Velvet sofa", kind: "skin", emoji: "🟣" },
    { stars: 9, id: "theme-sunset", name: "Sunset sky", kind: "theme", emoji: "🌇" },
    { stars: 14, id: "sofa-lemon", name: "Lemon sofa", kind: "skin", emoji: "🟡" },
    { stars: 19, id: "sofa-leather", name: "Leather sofa", kind: "skin", emoji: "🟤" },
    { stars: 24, id: "trophy-keys", name: "Golden keys", kind: "trophy", emoji: "🔑" },
  ],
  controls: CONTROLS,
  menu: { prev: "prev", next: "next", ok: "ok", back: "back", hint: "◀ Prev / Next ▶ pick a level, ▶ Go to play, ✓ Done to finish" },
  practice: ["ok"],
  create: (level, seed, o) => new CarrySim(LEVELS[level]!, seed, o.skin, o.colors, o.quick),
};

export function CarryHomeGame(props: GameProps) {
  return <GridShell {...props} title={CARRY} />;
}
