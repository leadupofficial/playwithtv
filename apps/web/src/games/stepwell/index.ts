/**
 * STEPWELL SECRETS: a puzzle-traversal platformer down an ancient step-well. Asha the explorer (and friends, in
 * their own colours) grab ledges, climb ropes, pull levers to open iron gates for a few seconds, cross crumbling
 * floors and time the breathing spike traps, then outwit the Stone Makara at the bottom pool with its own bells.
 */
import type { BossDef } from "../kitplat/boss";
import { FEEL_CLASSIC, type Feel } from "../kitplat/feel";
import type { PlatGameDef } from "../kitplat/game";
import { platControls } from "../kitplat/input";
import { makePlatformer } from "../kitplat/PlatformerGame";
import type { PowerDef } from "../kitplat/powerups";
import { LEVELS, QUICK } from "./levels";

/** Deliberate, weighty movement: lower jumps, ledges to grab, ladders and ropes. */
export const FEEL: Feel = {
  ...FEEL_CLASSIC, walk: 5.4, run: 7.8, maxSpeed: 10, accel: 34, decel: 50, turn: 70, airAccel: 26, jumpHeight: 3.4,
  gravity: 52, fallGravity: 74, ledgeGrab: true, climb: 3.8, spring: 6.5,
};

export const POWERS: PowerDef[] = [
  { id: "feather", name: "Garuda Feather", icon: "feather", toast: "🪶 Garuda Feather! Jump again in mid-air", seconds: 20, airJumps: 1, overlay: "feather-open" },
  { id: "bell", name: "Temple Bell", icon: "bell", toast: "🔔 Temple Bell! It rings off one hit", seconds: 0, shield: 1 },
  { id: "lamp", name: "Oil Lamp", icon: "lamp", toast: "🪔 Oil Lamp! Press ACTION to throw a flame", seconds: 20, projectile: { speed: 11, cooldown: 0.45, sprite: "shot", life: 1.0 } },
];

export const BOSS: BossDef = {
  id: "makara", name: "The Stone Makara", sprite: "boss", hp: 3, hw: 1.5, h: 1.9, damage: ["hazard", "stomp", "projectile"],
  pattern: [
    { kind: "walk", seconds: 2.4, speed: 2 }, { kind: "charge", seconds: 3, speed: 8 }, { kind: "rest", seconds: 2.6, vulnerable: true },
    { kind: "walk", seconds: 2.0, speed: 2.4 }, { kind: "rest", seconds: 1.0 },
  ],
  angry: [{ kind: "charge", seconds: 2.6, speed: 10 }, { kind: "rest", seconds: 2.2, vulnerable: true }, { kind: "walk", seconds: 1.6, speed: 3 }],
};

export const DEF: PlatGameDef = {
  spec: { id: "stepwell-secrets", title: "Stepwell Secrets", feel: FEEL, levels: LEVELS, quick: QUICK, powers: POWERS, bosses: [BOSS], modes: ["coop", "race"],
    hearts: 3, loopSpeed: 99, leverSeconds: 7 },
  controls: platControls("Stepwell Secrets", { stick: "arrows", act: "✋ LEVER", actColor: "#e8336d", hints: {
    buttons: "◀ ▶ to move, ▲ ▼ to climb · JUMP (hold toward a wall to grab its ledge) · LEVER to pull levers",
    motion: "Turn the phone like a wheel to run · flick up to jump · push towards the TV to pull a lever",
    touchpad: "Drag to move (up/down to climb) · tap or swipe up to jump · swipe down to pull a lever",
  } }),
  theme: "stepwell", hero: "asha", title: "Stepwell Secrets", emoji: "🗝️", tagline: "Down the thousand steps: mind the traps!",
  colors: ["#8a6a45", "#2a1d14"], keyHue: 330, overlays: { feather: "feather-open" }, rain: 0,
  modeNames: { coop: "Explorers Together", race: "Treasure Race" },
  modeBlurbs: { coop: "Hold the gates for each other and reach the pool together. Fallen explorers float back in bubbles.", race: "First to the bottom of the well claims the treasure." },
  podiumTitle: "🗝️ KEEPERS OF THE WELL 🗝️", winText: "Keeper of the Well!",
  awards: {
    score: { emoji: "🗝️", title: "Keeper of the Well", detail: (n) => `${n.toLocaleString("en-IN")} points` },
    bossHits: { emoji: "🔔", title: "Bell Ringer", detail: (n) => `${n} blow${n === 1 ? "" : "s"} on the Stone Makara` },
    levers: { emoji: "✋", title: "Lever Lover", detail: (n) => `pulled ${n} levers` },
    stomps: { emoji: "🪲", title: "Beetle Bopper", detail: (n) => `${n} critters stomped` },
    gems: { emoji: "🪙", title: "Coin Hoarder", detail: (n) => `${n} ancient coins` },
    falls: { emoji: "💦", title: "Well Tester", detail: (n) => `checked the water ${n} times` },
    revives: { emoji: "🫧", title: "Rope Buddy", detail: (n) => `pulled ${n} friend${n === 1 ? "" : "s"} back` },
    jumps: { emoji: "🦘", title: "Step Skipper", detail: (n) => `${n} jumps` },
    bonks: { emoji: "🙃", title: "Head Hopper", detail: (n) => `bounced on ${n} heads` },
    crates: { emoji: "🏺", title: "Pot Smasher", detail: (n) => `${n} pots smashed` },
    airTime: { emoji: "🪶", title: "Light as a Feather", detail: (n) => `${n} s in the air` },
  },
};

export const CONTROLS = DEF.controls;
export const StepwellSecretsGame = makePlatformer(DEF);
