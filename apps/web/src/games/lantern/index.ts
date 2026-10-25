/**
 * LANTERN LANE: a classic co-op platformer on a festival night. Diya and friends (each in their own colour) run
 * through lantern-lit lanes, over marigold bamboo bridges and up kite hill, bump gift boxes for gems, fly with
 * kites, throw sparklers, hide behind paper-lantern shields, and topple the Grumble Puppet in the square.
 */
import type { BossDef } from "../kitplat/boss";
import { FEEL_CLASSIC, type Feel } from "../kitplat/feel";
import type { PlatGameDef } from "../kitplat/game";
import { platControls } from "../kitplat/input";
import { makePlatformer } from "../kitplat/PlatformerGame";
import type { PowerDef } from "../kitplat/powerups";
import { LEVELS, QUICK } from "./levels";

export const FEEL: Feel = { ...FEEL_CLASSIC };

export const POWERS: PowerDef[] = [
  { id: "kite", name: "Kite Wings", icon: "kite", toast: "🪁 Kite Wings! Jump again in the air, hold JUMP to glide", seconds: 20, airJumps: 1, glide: 4.5, overlay: "kite-open" },
  { id: "sparkler", name: "Sparkler", icon: "sparkler", toast: "✨ Sparkler! Press ACTION to throw sparks", seconds: 20, projectile: { speed: 13, cooldown: 0.35, sprite: "shot", life: 1.2 } },
  { id: "lantern", name: "Lantern Shield", icon: "lantern", toast: "🏮 Lantern Shield! It takes one hit for you", seconds: 0, shield: 1 },
];

export const BOSS: BossDef = {
  id: "puppet", name: "The Grumble Puppet", sprite: "boss", hp: 4, hw: 0.9, h: 2.7, damage: ["stomp", "projectile"], summon: "walker",
  shot: { speed: 8, gravity: 16, sprite: "bossshot" },
  pattern: [
    { kind: "walk", seconds: 2, speed: 2 }, { kind: "hop", seconds: 3, count: 2, speed: 4 }, { kind: "rest", seconds: 2.4, vulnerable: true },
    { kind: "shoot", seconds: 2.4, count: 3 }, { kind: "summon", seconds: 1.4 }, { kind: "charge", seconds: 2.5, speed: 8 }, { kind: "rest", seconds: 2.2, vulnerable: true },
  ],
  angry: [
    { kind: "shoot", seconds: 2.2, count: 4 }, { kind: "hop", seconds: 3, count: 3, speed: 5 }, { kind: "rest", seconds: 2, vulnerable: true },
    { kind: "charge", seconds: 2.2, speed: 10 }, { kind: "summon", seconds: 1.2 }, { kind: "rest", seconds: 2, vulnerable: true },
  ],
};

export const DEF: PlatGameDef = {
  spec: { id: "lantern-lane", title: "Lantern Lane", feel: FEEL, levels: LEVELS, quick: QUICK, powers: POWERS, bosses: [BOSS], modes: ["coop", "race"],
    hearts: 3, loopSpeed: 99, leverSeconds: 6 },
  controls: platControls("Lantern Lane", { stick: "arrows", act: "✨ THROW", hints: {
    buttons: "◀ ▶ to move, ▲ ▼ on ladders · hold JUMP to jump higher · hold RUN · THROW sparklers",
    motion: "Turn the phone like a wheel to run · flick up to jump · push towards the TV to throw",
    touchpad: "Drag to run (up/down on ladders) · tap or swipe up to jump · swipe down to throw",
  } }),
  theme: "festival", hero: "diya", title: "Lantern Lane", emoji: "🏮", tagline: "Light up the festival: together!",
  colors: ["#5a2f78", "#140d33"], keyHue: 330, overlays: { kite: "kite-open" }, rain: 0,
  modeNames: { coop: "Festival Friends", race: "Lantern Race" },
  modeBlurbs: { coop: "Everyone reaches the lantern gate together. Fallen friends float back in bubbles.", race: "First through the lantern gate wins the sweets." },
  podiumTitle: "🏮 STARS OF THE FESTIVAL 🏮", winText: "Star of the festival!",
  awards: {
    score: { emoji: "🏮", title: "Star of the Festival", detail: (n) => `${n.toLocaleString("en-IN")} points` },
    bossHits: { emoji: "🎎", title: "Puppet Toppler", detail: (n) => `${n} hit${n === 1 ? "" : "s"} on the Grumble Puppet` },
    stomps: { emoji: "🏺", title: "Pot Popper", detail: (n) => `${n} grumpy pots and lanterns stomped` },
    gems: { emoji: "🪙", title: "Sweet Tooth", detail: (n) => `${n} golden sweets collected` },
    crates: { emoji: "🎁", title: "Gift Unwrapper", detail: (n) => `${n} gift boxes bumped open` },
    falls: { emoji: "🫠", title: "Clumsy Kite", detail: (n) => `took ${n} tumbles` },
    revives: { emoji: "🫧", title: "Bubble Buddy", detail: (n) => `popped ${n} friend${n === 1 ? "" : "s"} back` },
    jumps: { emoji: "🦘", title: "Rangoli Hopper", detail: (n) => `${n} jumps` },
    bonks: { emoji: "🙃", title: "Head Hopper", detail: (n) => `bounced on ${n} heads` },
    kicks: { emoji: "⚽", title: "Pangolin Striker", detail: (n) => `${n} kick${n === 1 ? "" : "s"}` },
    powers: { emoji: "🪁", title: "Kite Collector", detail: (n) => `${n} power-ups grabbed` },
    airTime: { emoji: "🪁", title: "High Flyer", detail: (n) => `${n} s in the air` },
  },
};

export const CONTROLS = DEF.controls;
export const LanternLaneGame = makePlatformer(DEF);
