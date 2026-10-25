/**
 * MONSOON COURIER: a speed platformer on rain-soaked rooftops. Keeri the mongoose courier (and friends, in their
 * own colours) races parcels across the monsoon city: boost pads, tin-roof slopes, loops and springs, and the
 * Mango Bandit, a cheeky monkey who stole the last parcel. Race (default) or deliver together (co-op).
 */
import type { BossDef } from "../kitplat/boss";
import { FEEL_CLASSIC, type Feel } from "../kitplat/feel";
import type { PlatGameDef } from "../kitplat/game";
import { platControls } from "../kitplat/input";
import { makePlatformer } from "../kitplat/PlatformerGame";
import type { PowerDef } from "../kitplat/powerups";
import { LEVELS, QUICK } from "./levels";

export const FEEL: Feel = {
  ...FEEL_CLASSIC, walk: 8, run: 12.5, maxSpeed: 18, accel: 30, decel: 26, turn: 60, airAccel: 28, overDecel: 6,
  jumpHeight: 4.4, slopeGravity: 22, spring: 8.5, stomp: 2.4,
};

export const POWERS: PowerDef[] = [
  { id: "umbrella", name: "Umbrella", icon: "umbrella", toast: "☂️ Umbrella! Hold JUMP to float", seconds: 18, glide: 3.2, overlay: "umbrella-open" },
  { id: "chai", name: "Chai Rush", icon: "chai", toast: "🍵 Chai Rush! Faster feet", seconds: 9, speed: 1.3, jump: 1.08 },
  { id: "tiffin", name: "Tiffin Magnet", icon: "tiffin", toast: "🧲 Tiffin Magnet! Gems fly to you", seconds: 15, magnet: 5 },
];

export const BOSS: BossDef = {
  id: "bandit", name: "The Mango Bandit", sprite: "boss", hp: 3, hw: 0.75, h: 2.0, damage: ["stomp", "projectile"],
  shot: { speed: 9, gravity: 14, sprite: "bossshot" },
  pattern: [
    { kind: "walk", seconds: 1.6, speed: 2.5 }, { kind: "shoot", seconds: 2.2, count: 3 }, { kind: "hop", seconds: 3, count: 3, speed: 4 },
    { kind: "rest", seconds: 2.2, vulnerable: true }, { kind: "charge", seconds: 2.5, speed: 9 }, { kind: "rest", seconds: 2.0, vulnerable: true },
  ],
  angry: [
    { kind: "shoot", seconds: 2.0, count: 4 }, { kind: "charge", seconds: 2.2, speed: 11 }, { kind: "rest", seconds: 1.8, vulnerable: true },
    { kind: "hop", seconds: 3, count: 4, speed: 5 }, { kind: "rest", seconds: 1.8, vulnerable: true },
  ],
};

export const DEF: PlatGameDef = {
  spec: { id: "monsoon-courier", title: "Monsoon Courier", feel: FEEL, levels: LEVELS, quick: QUICK, powers: POWERS, bosses: [BOSS], modes: ["race", "coop"],
    hearts: 3, loopSpeed: 10, leverSeconds: 6 },
  controls: platControls("Monsoon Courier", { stick: "arrows-h", act: "✨ ACTION" }),
  theme: "monsoon", hero: "keeri", title: "Monsoon Courier", emoji: "☔", tagline: "Race the rain across the rooftops: the parcels must get through!",
  colors: ["#3d5a80", "#141d2b"], keyHue: 330, overlays: { umbrella: "umbrella-open" }, rain: 1,
  modeNames: { race: "Courier Race", coop: "Deliver Together" },
  modeBlurbs: { race: "First to the doorstep wins. Fall behind and the rain sweeps you back into the pack.", coop: "One team, one parcel. Fallen couriers float back in bubbles." },
  podiumTitle: "📦 COURIERS OF THE MONTH 📦", winText: "Fastest courier in the city!",
  awards: {
    score: { emoji: "📦", title: "Courier of the Month", detail: (n) => `${n.toLocaleString("en-IN")} points` },
    bossHits: { emoji: "🥭", title: "Mango Dodger", detail: (n) => `${n} bonk${n === 1 ? "" : "s"} on the Bandit` },
    stomps: { emoji: "🦀", title: "Crab Squasher", detail: (n) => `${n} rooftop pests flattened` },
    gems: { emoji: "💧", title: "Raindrop Collector", detail: (n) => `${n} raindrop gems` },
    falls: { emoji: "🌧", title: "Gutter Inspector", detail: (n) => `fell off the roof ${n} times` },
    revives: { emoji: "🫧", title: "Bubble Buddy", detail: (n) => `popped ${n} team-mate${n === 1 ? "" : "s"} back` },
    topSpeed: { emoji: "⚡", title: "Faster Than the Monsoon", detail: (n) => `top speed ${n} tiles a second` },
    jumps: { emoji: "🦘", title: "Pogo Paws", detail: (n) => `${n} jumps` },
    bonks: { emoji: "🙃", title: "Head Hopper", detail: (n) => `bounced on ${n} heads` },
    loops: { emoji: "🌀", title: "Loop-de-Loop", detail: (n) => `${n} loop${n === 1 ? "" : "s"} at full speed` },
    airTime: { emoji: "🪁", title: "Frequent Flyer", detail: (n) => `${n} s in the air` },
    kicks: { emoji: "⚽", title: "Pangolin Striker", detail: (n) => `${n} kick${n === 1 ? "" : "s"}` },
  },
};

export const CONTROLS = DEF.controls;
export const MonsoonCourierGame = makePlatformer(DEF);
