/**
 * KALARI CLASH rules: types, tuning constants and frame data. Pure (no DOM, no three.js).
 *
 * Time is in seconds; frame data is written in 60 fps frames (F(n) = n / 60) because that is how fighting-game
 * moves are tuned. Ground plane: x right, z towards the camera; y up. face = yaw, forward = (sin face, cos face).
 */

export const DT = 1 / 60;
export const F = (frames: number) => frames / 60;

export type MoveId = "jab" | "cross" | "kick" | "heavy";
export type FighterId = "simha" | "mayil" | "puli" | "ashwa";

export interface MoveData {
  startup: number;   // seconds before the hit can land
  active: number;    // seconds the hitbox is out
  recovery: number;  // seconds after, before acting again (cancelled by a chain)
  damage: number;    // health points
  kb: number;        // knockback speed (m/s) at full health
  lift: number;      // upward speed on hit (m/s)
  reach: number;     // metres in front of the attacker
  arc: number;       // half-angle of the hit cone (radians)
  hitstun: number;   // seconds the victim cannot act
  next: MoveId | null; // the STRIKE chain: jab → cross → kick
  guardBreak: boolean;
  lunge: number;     // forward step speed during startup (m/s)
}

export const MOVES: Record<MoveId, MoveData> = {
  jab: { startup: F(6), active: F(4), recovery: F(11), damage: 4, kb: 2.6, lift: 0, reach: 1.45, arc: 1.0, hitstun: F(20), next: "cross", guardBreak: false, lunge: 2.5 },
  cross: { startup: F(7), active: F(4), recovery: F(13), damage: 5, kb: 3.2, lift: 0, reach: 1.5, arc: 1.0, hitstun: F(22), next: "kick", guardBreak: false, lunge: 3 },
  kick: { startup: F(10), active: F(5), recovery: F(20), damage: 9, kb: 10, lift: 3.5, reach: 1.75, arc: 1.15, hitstun: F(30), next: null, guardBreak: false, lunge: 3.5 },
  heavy: { startup: F(19), active: F(5), recovery: F(26), damage: 14, kb: 11.5, lift: 4.5, reach: 1.9, arc: 1.2, hitstun: F(34), next: null, guardBreak: true, lunge: 2 },
};

/** A fighter's special: a cinematic move charged by landing hits. Hits are scheduled after the start. */
export interface SpecialData {
  name: string;
  /** Freeze before it starts (the TV cuts to a close-up). The fighter is invulnerable until the end. */
  windup: number;
  duration: number;
  /** Forward travel speed during [dashFrom, dashTo] seconds. */
  dash: number; dashFrom: number; dashTo: number;
  hits: Array<{ at: number; radius: number; arc: number; damage: number; kb: number; lift: number }>;
}

export interface CharacterData {
  id: FighterId;
  name: string;
  title: string;
  stance: string;   // the animal stance (vadivu) it is named after
  color: string;    // UI accent
  speed: number;    // m/s
  power: number;    // damage multiplier
  weight: number;   // knockback taken multiplier (lower = heavier)
  special: SpecialData;
}

export const ROSTER: CharacterData[] = [
  {
    id: "simha", name: "SIMHA", title: "Lion of the Courtyard", stance: "Lion stance", color: "#c41e2a", speed: 4.3, power: 1.18, weight: 0.82,
    special: { name: "LION'S ROAR", windup: 0.45, duration: 1.25, dash: 3.5, dashFrom: 0.1, dashTo: 0.55,
      hits: [{ at: 0.62, radius: 2.9, arc: Math.PI, damage: 22, kb: 13, lift: 7 }] },
  },
  {
    id: "mayil", name: "MAYIL", title: "Peacock of the Staff", stance: "Peacock stance", color: "#0e8a6a", speed: 4.9, power: 1, weight: 1,
    special: { name: "PEACOCK DANCE", windup: 0.4, duration: 1.3, dash: 1.2, dashFrom: 0, dashTo: 1.1,
      hits: [0.2, 0.42, 0.64, 0.86].map((at, i) => ({ at, radius: 2.4, arc: Math.PI, damage: 6, kb: i === 3 ? 12.5 : 2.5, lift: i === 3 ? 6 : 1 })) },
  },
  {
    id: "puli", name: "PULI", title: "Tiger of the Monsoon", stance: "Tiger stance", color: "#f07818", speed: 5.6, power: 0.92, weight: 1.15,
    special: { name: "TIGER POUNCE", windup: 0.4, duration: 1.05, dash: 11, dashFrom: 0.12, dashTo: 0.62,
      hits: [0.3, 0.45, 0.62].map((at, i) => ({ at, radius: 1.5, arc: 1.4, damage: i === 2 ? 12 : 5, kb: i === 2 ? 14 : 3, lift: i === 2 ? 6 : 1 })) },
  },
  {
    id: "ashwa", name: "ASHWA", title: "Stallion of the Shore", stance: "Horse stance", color: "#d8a238", speed: 5.0, power: 1.05, weight: 0.95,
    special: { name: "STALLION STORM", windup: 0.4, duration: 1.15, dash: 6, dashFrom: 0.05, dashTo: 0.8,
      hits: [0.2, 0.42, 0.64, 0.86].map((at, i) => ({ at, radius: 1.8, arc: 1.3, damage: i === 3 ? 10 : 5, kb: i === 3 ? 13.5 : 3, lift: i === 3 ? 6.5 : 0.5 })) },
  },
];

export const character = (id: FighterId) => ROSTER.find((c) => c.id === id)!;

// ---- tuning ----
export const MAX_HEALTH = 100;
export const METER_MAX = 100;
export const RADIUS = 0.5;            // body radius (fighters push apart)
export const ACCEL = 14;              // 1/s towards the wanted velocity
export const FRICTION = 5.5;          // 1/s sliding after knockback
export const GRAVITY = 22;
export const GUARD_SPEED = 0.35;      // movement while guarding
export const GUARD_ARC = 1.75;        // radians either side of facing that the guard covers
export const GUARD_CHIP = 0.15;       // share of damage that gets through a guard
export const PARRY_WINDOW = 0.15;     // pressing GUARD this close before a hit lands = parry
export const PARRY_STUN = 0.75;       // attacker reels this long after being parried
export const PARRY_LOCKOUT = 0.5;     // after a GUARD press that parried nothing, presses this soon only block
export const GUARD_BREAK_STUN = 0.55;
export const ROLL_TIME = 0.42;
export const ROLL_SPEED = 8.5;
export const ROLL_IFRAMES: [number, number] = [0.03, 0.32];
export const ROLL_COOLDOWN = 0.35;
export const BUFFER = 0.22;           // input buffer for strikes / heavies / rolls
export const LAUNCH_KB = 4.4;           // knockback at or above this launches the victim into the air
export const DOWN_TIME = 0.55;        // on the floor after a launch (invulnerable while getting up)
export const WALL_SPLAT_KB = 6;       // hitting a wall this fast hurts
export const CREDIT_WINDOW = 4;       // seconds a hitter keeps credit for a ring-out
export const SOFT_LOCK = 3.6;         // attacks turn towards the nearest opponent within this range
export const SECOND_WIND_AT = 30;     // health under which a fighter gets a one-off meter boost per round
export const RING_MARGIN = 0.35;      // how far past the edge counts as off the stage

export type FState =
  | "ok" | "attack" | "guard" | "stagger" | "hit" | "air" | "down" | "roll" | "special" | "fall" | "out" | "ko";

export interface Stats {
  hits: number; damage: number; kos: number; ringouts: number; parries: number; blocks: number; rolls: number;
  specials: number; maxCombo: number; roundWins: number; comebacks: number; walls: number; falls: number;
  /** Guardians: style points (variety, combos, parries, ring-outs). */
  style: number;
}
export const newStats = (): Stats => ({
  hits: 0, damage: 0, kos: 0, ringouts: 0, parries: 0, blocks: 0, rolls: 0, specials: 0, maxCombo: 0, roundWins: 0, comebacks: 0, walls: 0, falls: 0, style: 0,
});

export interface Fighter {
  id: string;
  cpu: boolean;
  slot: number;
  char: FighterId;
  /** Fighters only hit other teams: every fighter is its own team in versus (1…4); guardians are 0, clay golems -1. */
  team: number;
  /** A clay golem (Guardians mode). Dormant golems wait with alive = false and state "out". */
  foe: boolean;
  maxHealth: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  face: number;
  state: FState;
  t: number;               // seconds in the current state
  move: MoveId | null;
  struck: string[];        // victims already hit by the current move / special hit index
  specialHit: number;
  chainQueued: boolean;
  buffer: "strike" | "heavy" | "roll" | null;
  bufferT: number;
  guardT: number;          // seconds since GUARD was pressed (for the parry window); Infinity if not held
  parryLock: number;       // seconds until a fresh GUARD press can parry again (no parry spam)
  stun: number;
  rollCd: number;
  rollX: number; rollZ: number;
  health: number;
  meter: number;
  secondWind: boolean;
  combo: number; comboT: number;
  lastHitBy: string | null; lastHitAt: number;
  alive: boolean;
  underdog: boolean;
  stats: Stats;
}

export interface KalariInput {
  x: number; z: number;     // movement, magnitude ≤ 1 (z towards the camera)
  strike: boolean;          // pressed this step
  heavy: boolean;
  guard: boolean;           // held
  roll: boolean;
  special: boolean;
}
export const IDLE: KalariInput = { x: 0, z: 0, strike: false, heavy: false, guard: false, roll: false, special: false };

export type Mode = "versus" | "guardians";

export type Phase = "intro" | "countdown" | "fight" | "roundEnd" | "podium";

export interface Arena {
  id: string;
  /** Half-size of the fighting floor (metres). */
  hx: number; hz: number;
  /** Sides with a wall (fighters bounce off and take a wall splat) instead of a drop. */
  walls: { left: boolean; right: boolean; back: boolean; front: boolean };
}

export interface Match {
  mode: Mode;
  /** Guardians: the current wave (1-based) and how many there are; the team's style meter (decays). */
  wave: number; maxWaves: number; style: number;
  phase: Phase;
  t: number; time: number;
  round: number; maxRounds: number; roundsToWin: number;
  roundSeconds: number; roundLeft: number;
  introSeconds: number; countdownSeconds: number; countdownShown: number;
  arena: Arena;
  fighters: Fighter[];
  seed: number;
  roundWinner: string | null;
  matchWinner: string | null;
  lastKoAt: number | null;
  /** Fighter whose special is freezing the action (cinematic), and until when. */
  freeze: { id: string; until: number } | null;
}

export type KalariEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "countdown"; n: number }
  | { kind: "attack"; id: string; move: MoveId }
  | { kind: "whiff"; id: string; move: MoveId }
  | { kind: "hit"; by: string; on: string; move: MoveId | "special"; damage: number; kb: number; x: number; y: number; z: number; combo: number; launch: boolean; counter: boolean }
  | { kind: "block"; by: string; on: string; x: number; z: number }
  | { kind: "parry"; by: string; on: string; x: number; z: number }
  | { kind: "guard-break"; by: string; on: string; x: number; z: number }
  | { kind: "roll"; id: string }
  | { kind: "special-start"; id: string; name: string }
  | { kind: "special-ready"; id: string }
  | { kind: "second-wind"; id: string }
  | { kind: "wall"; id: string; x: number; z: number }
  | { kind: "land"; id: string; hard: boolean }
  | { kind: "ringout"; id: string; by: string | null; last: boolean }
  | { kind: "ko"; id: string; by: string | null; last: boolean }
  | { kind: "time-warning" }
  | { kind: "wave"; n: number; foes: number }
  | { kind: "wave-clear"; n: number; last: boolean }
  | { kind: "wiped" }
  | { kind: "round-end"; winner: string | null; reason: "ko" | "time" }
  | { kind: "match-end"; winner: string | null };

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Seeded PRNG (Park–Miller) on the match: replays identically in tests. */
export function rand(m: { seed: number }): number {
  m.seed = (m.seed * 16807) % 2147483647;
  return (m.seed - 1) / 2147483646;
}
