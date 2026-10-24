/**
 * Pillow Fort Brawl: shared types, tuning constants and seeded randomness for the pure rules
 * (engine.ts, combat.ts, chaos.ts, cpu.ts, awards.ts). No DOM, no three.js: everything here runs in Vitest.
 *
 * World units: x to the right, z towards the camera, y up. The arena is the top of a giant bed (a rectangle
 * of half-size HX × HZ); stepping more than EDGE past its left, right or front border means falling off ("the floor
 * is lava!"). The back border is the headboard and its big pillows: a soft wall you bounce off.
 */

export const DT = 1 / 60;
export const HX = 6.4, HZ = 4.7;
/** How far past the mattress border a fighter can teeter before falling off. */
export const EDGE = 0.35;
/** The room ghosts float around in (a little bigger than the bed). */
export const ROOM_X = HX + 2.5, ROOM_Z = HZ + 2;
export const RADIUS = 0.55;

export const SPEED = 5.4;          // run speed (units/s)
export const CHARGE_SLOW = 0.45;   // move speed factor while charging
export const FEATHER_SLOW = 0.5;   // move speed factor inside a feather pile
export const ACCEL = 14;           // how fast velocity follows the stick
export const FRICTION = 4.5;       // knockback slide damping (1/s) on the mattress
export const AIR_FRICTION = 0.9;
export const GRAVITY = 24;

export const CHARGE_TIME = 0.9;    // seconds to a full charge
export const MIN_POWER = 0.15;     // the weakest swing (a quick tap)
export const REACH = 1.7;          // swing reach (plus up to 0.4 for a full charge)
export const ARC = (75 * Math.PI) / 180;
export const KB_BASE = 3.4, KB_POWER = 9.5;
/** Knockback grows by 100% for every WOBBLE % of damage. */
export const WOBBLE = 60;
export const DMG_BASE = 7, DMG_POWER = 15;

export const DODGE_SPEED = 13, DODGE_TIME = 0.2, DODGE_COOLDOWN = 0.85;
export const GHOST_SPEED = 7, GHOST_COOLDOWN = 2.4, MAX_HAZARDS = 6;
/** Credit for a ring-out goes to whoever hit the faller within this many seconds. */
export const CREDIT_WINDOW = 3.5;

export type Phase = "intro" | "countdown" | "fight" | "roundEnd" | "podium";
export type FState = "ok" | "charge" | "windup" | "swing" | "hit" | "dodge" | "fall" | "ghost";

export interface Stats {
  hits: number;
  smashes: number;
  /** Feathers knocked out of pillows (more for harder hits). */
  feathers: number;
  falls: number;
  /** Times this fighter was the first one off the bed in a round. */
  firstOuts: number;
  kos: number;
  dodges: number;
  hazards: number;
  slipsCaused: number;
  roundWins: number;
  /** Rounds won after being behind on round wins. */
  comebacks: number;
  bestHit: number;
}

export interface Fighter {
  id: string;
  cpu: boolean;
  slot: number;
  x: number; z: number; y: number;
  vx: number; vz: number; vy: number;
  /** Facing angle: 0 = towards the camera (+z), π/2 = right (+x). */
  face: number;
  state: FState;
  /** Seconds in the current state. */
  t: number;
  charge: number;
  power: number;
  /** A swing asked for while busy, done as soon as possible (input buffering), and how long it is kept. */
  queued: number;
  queuedT: number;
  hitDone: boolean;
  cooldown: number;
  dodgeCd: number;
  dodgeX: number; dodgeZ: number;
  stun: number;
  /** Wobble %: knockback taken grows with it (like a pillow losing its stuffing). */
  damage: number;
  lastHitBy: string | null;
  lastHitAt: number;
  alive: boolean;
  slowed: number;
  combo: number;
  comboT: number;
  underdog: boolean;
  ghostCd: number;
  ghostDrops: number;
  stats: Stats;
}

export interface Hazard { id: number; kind: "feathers" | "sock"; x: number; z: number; age: number; life: number; by: string }
/** A pillow falling from the ceiling during an avalanche: lands when `t` reaches 0. */
export interface Drop { id: number; x: number; z: number; t: number }
export type ChaosKind = "bounce" | "nightlight" | "avalanche";
export interface Chaos { kind: ChaosKind; t: number; dur: number; n: number }

export interface Match {
  phase: Phase;
  /** Seconds in the current phase. */
  t: number;
  /** Total simulated seconds. */
  time: number;
  round: number;
  roundSeconds: number;
  roundLeft: number;
  roundsToWin: number;
  maxRounds: number;
  introSeconds: number;
  countdownSeconds: number;
  fighters: Fighter[];
  hazards: Hazard[];
  drops: Drop[];
  chaos: Chaos | null;
  nextChaos: number;
  /** Seconds into a round for the first chaos event (null = random 13–20 s). */
  firstChaos: number | null;
  lastChaos: ChaosKind | null;
  seed: number;
  nextId: number;
  roundWinner: string | null;
  /** Set when the round's last knockout happened (the TV plays it in slow motion). */
  lastKoAt: number | null;
  firstOutDone: boolean;
  matchWinner: string | null;
  countdownShown: number;
}

export interface BrawlInput {
  /** Movement in [-1, 1]: x right, z towards the camera. */
  x: number;
  z: number;
  /** SWING is held (charging). Letting go swings with the charge built so far. */
  charge: boolean;
  /** An instant swing with this power (0 = none): a tap, a push gesture (motion) or a touchpad tap. */
  swing: number;
  dodge: boolean;
}

export const IDLE: BrawlInput = { x: 0, z: 0, charge: false, swing: 0, dodge: false };

export type BrawlEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "countdown"; n: number }
  | { kind: "charge-full"; id: string }
  | { kind: "swing"; id: string; power: number }
  | { kind: "hit"; by: string; on: string; power: number; kb: number; x: number; z: number; combo: number; smash: boolean }
  | { kind: "whiff"; id: string }
  | { kind: "dodge"; id: string }
  | { kind: "fall"; id: string; by: string | null; first: boolean; last: boolean }
  | { kind: "ghost"; id: string }
  | { kind: "hazard"; by: string; hazard: Hazard["kind"]; x: number; z: number }
  | { kind: "slip"; id: string; by: string; x: number; z: number }
  | { kind: "chaos"; chaos: ChaosKind }
  | { kind: "bounce" }
  | { kind: "drop-land"; x: number; z: number; hits: string[] }
  | { kind: "land"; id: string; hard: boolean }
  | { kind: "time-warning" }
  | { kind: "round-end"; winner: string | null; reason: "ko" | "time" }
  | { kind: "match-end"; winner: string | null };

/** Park–Miller minimal standard generator: deterministic for a seed, state kept in the match. */
export function rand(m: { seed: number }): number {
  m.seed = (m.seed * 16807) % 2147483647;
  return (m.seed - 1) / 2147483646;
}

export function newStats(): Stats {
  return { hits: 0, smashes: 0, feathers: 0, falls: 0, firstOuts: 0, kos: 0, dodges: 0, hazards: 0, slipsCaused: 0, roundWins: 0, comebacks: 0, bestHit: 0 };
}

/** Smallest signed difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Distance from a point to the nearest open mattress border (negative once past it); the headboard side is a wall. */
export function edgeDistance(x: number, z: number): number {
  return Math.min(HX - Math.abs(x), HZ - z);
}
