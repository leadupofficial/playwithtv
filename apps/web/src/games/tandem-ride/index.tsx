/**
 * Tandem Ride (couples, co-op): an anniversary weekend on a hired tandem bike. Each phone pedals one seat
 * by rocking side to side; pedal in step for a speed boost, press Jump together to leap logs and reach the
 * high flowers, and race Grandpa Joe's ghost bike to the picnic. 6 rides in 3 worlds; stars unlock new
 * bike paint and a sunset sky.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameProps } from "../types";
import { GridShell } from "../kitgrid/Shell";
import type { GridTitle } from "../kitgrid/types";
import { LEVELS, WORLDS } from "./levels";
import { TandemSim } from "./sim";

const MENU: ControlSpec["actions"][number]["buttonIn"] = ["buttons", "hybrid", "touchpad"];

export const CONTROLS: ControlSpec = {
  title: "Tandem Ride",
  modes: ["hybrid", "buttons", "touchpad"],
  stick: "joystick",
  tilt: "tray",
  actions: [
    { id: "prev", label: "◀ Prev", swipes: ["swipe-left"], buttonIn: MENU },
    { id: "jump", label: "⬆ Jump", color: "#3ee08f", gestures: ["flick-up"], swipes: ["tap"], buttonIn: MENU },
    { id: "next", label: "Next ▶", swipes: ["swipe-right"], buttonIn: MENU },
    { id: "done", label: "✓ Done", swipes: ["swipe-down"], buttonIn: MENU },
  ],
  hints: {
    hybrid: "Rock your phone left, right, left, right to pedal. Pedal in step with your partner to fly. ⬆ Jump together for logs",
    buttons: "Push the joystick left, right, left, right to pedal, in step with your partner. ⬆ Jump together for logs",
    touchpad: "Swipe your finger left, right, left, right to pedal, tap to jump. Jump together for logs",
  },
};

export const TANDEM: GridTitle = {
  id: "tandem-ride",
  name: "Tandem Ride",
  emoji: "🚲",
  coop: true,
  themes: {
    "": "linear-gradient(#7cc6f5, #bfe6ff)",
    "theme-sunset": "linear-gradient(#ff8a6b, #ffcf8a)",
  },
  story: { heroSprite: "", heroName: "Sam & Riya", worlds: WORLDS },
  levels: LEVELS.map((l) => ({
    name: l.name,
    world: l.world,
    brief: `${l.track.length} m · beat Grandpa Joe in ${l.par} s${l.track.includes("L") ? " · logs: jump together!" : ""}`,
  })),
  rewards: [
    { stars: 3, id: "bike-mint", name: "Mint bike", kind: "skin", emoji: "🚲" },
    { stars: 7, id: "theme-sunset", name: "Sunset sky", kind: "theme", emoji: "🌅" },
    { stars: 11, id: "bike-gold", name: "Golden bike", kind: "skin", emoji: "✨" },
    { stars: 18, id: "trophy-bell", name: "Golden bell", kind: "trophy", emoji: "🔔" },
  ],
  controls: CONTROLS,
  menu: { prev: "prev", next: "next", ok: "jump", back: "done", hint: "◀ Prev / Next ▶ pick a ride, ⬆ to ride, ✓ Done to finish" },
  menuOnly: ["prev", "next", "done"],
  practice: ["jump"],
  create: (level, seed, o) => new TandemSim(LEVELS[level]!, seed, o.skin, o.colors, o.quick, o.theme),
};

export function TandemRideGame(props: GameProps) {
  return <GridShell {...props} title={TANDEM} />;
}
