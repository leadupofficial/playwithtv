/**
 * kitplat/types: the game-facing data model. A game is a GameSpec (feel, levels, power-ups, bosses, names);
 * the world holds heroes, foes, items and the camera while a level is played.
 */
import type { Boss, BossDef } from "./boss";
import type { Cam } from "./camera";
import type { Collider } from "./collide";
import type { Feel } from "./feel";
import type { Foe } from "./foes";
import type { Level, LevelDef } from "./level";
import type { Mover } from "./player";
import type { PowerDef } from "./powerups";

export type Mode = "coop" | "race";

export interface GameSpec {
  id: string;
  title: string;
  feel: Feel;
  levels: LevelDef[];
  /** The short version (?quick=1): usually one small level. */
  quick: LevelDef[];
  powers: PowerDef[];
  bosses: BossDef[];
  /** Offered modes, default first. */
  modes: Mode[];
  hearts: number;
  /** Loops capture heroes running faster than this (tiles/s). */
  loopSpeed: number;
  /** Seconds a lever keeps its gates open (0 = they stay open). */
  leverSeconds: number;
}

export interface HeroStats {
  jumps: number; stomps: number; falls: number; hits: number; gems: number; revives: number; bubbles: number; crates: number;
  boosts: number; bonks: number; powers: number; bossHits: number; checkpoints: number; levers: number; loops: number; kicks: number;
  topSpeed: number; airTime: number;
}

export interface Hero extends Mover {
  slot: number;
  id: string;
  hearts: number;
  /** Invulnerability left (s): blinking. */
  inv: number;
  power: PowerDef | null;
  powerT: number;
  shield: number;
  /** "" active, "bubble" floating (co-op), "wait" before a respawn (race). */
  down: "" | "bubble" | "wait";
  downT: number;
  checkpoint: { x: number; y: number };
  finished: boolean;
  finishT: number;
  place: number;
  score: number;
  /** Score this level (shown on the level card). */
  levelScore: number;
  combo: number;
  boostT: number;
  flipT: number;
  hurtT: number;
  /** Seconds since landing (squash), or a big negative number. */
  landT: number;
  landV: number;
  loop: { cx: number; cy: number; a: number; speed: number } | null;
  shotCd: number;
  stragT: number;
  stats: HeroStats;
}

export type ItemKind = "gem" | "biggem" | "powerup" | "spring" | "boost" | "checkpoint" | "goal" | "leverA" | "leverB" | "loop";

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
  taken: boolean;
  /** Animation clock (springs boing, levers swing, checkpoints wave). */
  t: number;
  power: string | null;
  on: boolean;
  /** Gem pulled by a magnet: flying to this hero slot (-1 none). */
  pull: number;
}

export type EventKind =
  | "jump" | "airjump" | "land" | "gem" | "biggem" | "stomp" | "hurt" | "down" | "revive" | "bubble" | "spring" | "boost" | "checkpoint"
  | "finish" | "power" | "powerlost" | "crate" | "kick" | "bosshit" | "bossdown" | "bosswake" | "slam" | "shoot" | "throw" | "lever" | "crumble"
  | "loop" | "wipe" | "timeup" | "clear" | "bump" | "bonk" | "shield" | "splash" | "go";

export interface GameEvent { kind: EventKind; x: number; y: number; slot: number; v: number }

export interface Shot { x: number; y: number; vx: number; vy: number; life: number; slot: number; alive: boolean }

export type Phase = "intro" | "play" | "clear" | "timeup";

export interface World {
  spec: GameSpec;
  level: Level;
  col: Collider;
  mode: Mode;
  heroes: Hero[];
  foes: Foe[];
  items: Item[];
  boss: Boss | null;
  shots: Shot[];
  movers: Array<{ x0: number; y0: number; axis: "h" | "v"; travel: number; period: number }>;
  cam: Cam;
  phase: Phase;
  phaseT: number;
  /** Seconds played this level and left on the clock. */
  time: number;
  clock: number;
  teamCheckpoint: { x: number; y: number };
  gateT: [number, number];
  /** Crumbling tiles: seconds since first stood on (>0) or until they come back (<0); index = r * w + c. */
  crumble: Float32Array;
  continues: number;
  events: GameEvent[];
  finishOrder: number[];
  firstFinishT: number;
  done: boolean;
  seed: number;
  wipeT: number;
  bossAt: { x: number; y: number } | null;
}
