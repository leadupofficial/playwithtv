/**
 * One racer's driving physics in the road frame (see track.ts): auto-gas, smoothed steering with a gentle
 * road-following assist, drifting that charges a 3-level mini-turbo (blue → orange → purple sparks), a Burnout
 * boost meter, jumps off crests, rail scrapes, spin-outs and wrecks with a quick respawn. Pure and deterministic.
 */
import { frameAt, type Frame, type Track } from "./track";
import type { ItemKind } from "./items";

export type Kind = "auto" | "scooter" | "car";

export interface KindStats { len: number; wid: number; vmax: number; accel: number; turn: number; mass: number; label: string }

/** Different feel, equal pace: scooters are nimble and light, cars heavy (they shove harder), autos in between. */
export const KINDS: Record<Kind, KindStats> = {
  auto: { len: 2.3, wid: 1.35, vmax: 40, accel: 19, turn: 2.05, mass: 1.0, label: "Auto" },
  scooter: { len: 1.8, wid: 0.85, vmax: 40.7, accel: 21, turn: 2.2, mass: 0.75, label: "Scooter" },
  car: { len: 2.8, wid: 1.5, vmax: 39.5, accel: 18.5, turn: 1.95, mass: 1.35, label: "Hatch" },
};

export const G = 22;                       // arcade gravity (snappy jumps)
export const ASSIST = 0.45;                // share of the road's curve the vehicle follows by itself
export const DRIFT_LEVELS = [0.6, 1.25, 2.0] as const; // seconds of drifting for each mini-turbo level
/** Drift yaw rate (rad/s) = base + range × (into + 1), into = steer × drift direction (-1 counter … 1 full). */
export const DRIFT_YAW = [0.25, 0.5] as const;
export const TURBO = [
  { t: 0.55, power: 1.25 },
  { t: 0.95, power: 1.33 },
  { t: 1.45, power: 1.45 },
] as const;
export const BOOST_COST = 1 / 3;
export const BOOST_TIME = 1.5;
export const BOOST_POWER = 1.42;
/** Instant kick when a boost fires (m/s): the jump you feel. */
export const BOOST_KICK = 6;
export const WRECK_TIME = 1.25;
export const RESPAWN_SHIELD = 1.6;
export const SPIN_TIME = 0.9;

export interface RacerInput {
  /** -1 (left) … 1 (right). */
  steer: number;
  /** Drift button held. */
  drift: boolean;
  /** BOOST tapped (edge). */
  boost: boolean;
  /** ITEM tapped (edge). */
  item: boolean;
}
export const IDLE: RacerInput = { steer: 0, drift: false, boost: false, item: false };

export interface RacerStats {
  takedowns: number; wrecked: number; crashes: number; nearMisses: number; air: number; drifts: number;
  turbos: [number, number, number]; boosts: number; items: number; rails: number; topSpeed: number;
  goatHits: number; goatDodges: number; drafted: number; coconutsHit: number; splashed: number;
}

export interface Racer {
  id: string;
  cpu: boolean;
  slot: number;
  kind: Kind;
  /** Distance along the road since the start line (grows lap after lap; negative on the grid). */
  s: number;
  /** Lateral offset (+ right). */
  d: number;
  /** Travel direction relative to the road (rad, + = pointing right). */
  a: number;
  v: number;
  /** ds/dt this step (for others: drafting, items). */
  sv: number;
  y: number;
  vy: number;
  air: boolean;
  airT: number;
  /** Lateral shove velocity (m/s), decays. */
  push: number;
  steer: number;
  /** 0, or the drift direction (-1 left, 1 right). */
  drift: number;
  driftT: number;
  /** Visual body slip (rad) on top of `a`. */
  slip: number;
  turboT: number;
  turboPower: number;
  boostT: number;
  /** Boost meter 0..1 (three segments). */
  meter: number;
  spinT: number;
  wreckT: number;
  shieldT: number;
  blindT: number;
  item: ItemKind | null;
  /** Item roulette still spinning. */
  rollT: number;
  catchUp: number;
  /** CPU pace factor (1 = full). */
  pace: number;
  lastHitBy: string | null;
  lastHitAt: number;
  finishedAt: number | null;
  place: number;
  lapShown: number;
  stats: RacerStats;
  /** Previous-step button states (to turn holds into edges). */
  prevDrift: boolean;
}

export function newRacer(id: string, slot: number, kind: Kind, cpu: boolean, s: number, d: number): Racer {
  return {
    id, cpu, slot, kind, s, d, a: 0, v: 0, sv: 0, y: 0, vy: 0, air: false, airT: 0, push: 0, steer: 0,
    drift: 0, driftT: 0, slip: 0, turboT: 0, turboPower: 1, boostT: 0, meter: 0.34, spinT: 0, wreckT: 0, shieldT: 0,
    blindT: 0, item: null, rollT: 0, catchUp: 0, pace: 1, lastHitBy: null, lastHitAt: -99, finishedAt: null, place: slot + 1,
    lapShown: 0, prevDrift: false,
    stats: {
      takedowns: 0, wrecked: 0, crashes: 0, nearMisses: 0, air: 0, drifts: 0, turbos: [0, 0, 0], boosts: 0, items: 0,
      rails: 0, topSpeed: 0, goatHits: 0, goatDodges: 0, drafted: 0, coconutsHit: 0, splashed: 0,
    },
  };
}

/** The current mini-turbo level a drift has charged (0 = none yet). */
export function driftLevel(r: Pick<Racer, "drift" | "driftT">): 0 | 1 | 2 | 3 {
  if (!r.drift) return 0;
  return r.driftT >= DRIFT_LEVELS[2] ? 3 : r.driftT >= DRIFT_LEVELS[1] ? 2 : r.driftT >= DRIFT_LEVELS[0] ? 1 : 0;
}

export const canDrive = (r: Racer) => r.wreckT <= 0 && r.finishedAt === null;

export type DriveEvent =
  | { kind: "driftStart"; id: string; dir: number }
  | { kind: "driftLevel"; id: string; level: 1 | 2 | 3 }
  | { kind: "turbo"; id: string; level: 1 | 2 | 3 }
  | { kind: "boost"; id: string }
  | { kind: "air"; id: string }
  | { kind: "land"; id: string; airT: number; impact: number }
  | { kind: "wall"; id: string; impact: number; side: number };

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 };
const fr2: Frame = { ...fr };

export function topSpeed(r: Racer): number {
  const k = KINDS[r.kind];
  let v = k.vmax * r.pace * (1 + r.catchUp);
  if (r.turboT > 0) v = Math.max(v, k.vmax * r.turboPower);
  if (r.boostT > 0) v = Math.max(v, k.vmax * BOOST_POWER * (1 + r.catchUp * 0.5));
  if (r.drift) v *= 0.96;
  return v;
}

/** Fires a boost from the meter if there is a full segment. Returns true if it fired. */
export function tryBoost(r: Racer): boolean {
  if (r.meter < BOOST_COST - 1e-6 || r.boostT > 0.25 || !canDrive(r) || r.spinT > 0) return false;
  r.meter -= BOOST_COST;
  r.boostT = BOOST_TIME;
  r.v += BOOST_KICK;
  r.stats.boosts++;
  return true;
}

/**
 * Advances one racer by dt. `walls` hits are reported (the race decides whether a hit is a takedown).
 * Does not handle other racers, traffic or items.
 */
export function drive(t: Track, r: Racer, inp: RacerInput, dt: number, out: DriveEvent[]): void {
  const k = KINDS[r.kind];
  r.shieldT = Math.max(0, r.shieldT - dt);
  r.blindT = Math.max(0, r.blindT - dt);
  r.rollT = Math.max(0, r.rollT - dt);
  if (r.wreckT > 0) {
    // tumbling: the respawn is handled by the race (it needs a safe spot)
    r.v = Math.max(0, r.v - 40 * dt);
    r.wreckT -= dt;
    r.drift = 0;
    r.driftT = 0;
    r.push *= Math.exp(-3 * dt);
    r.d += r.push * dt;
    r.s += r.v * dt * 0.5;
    return;
  }
  const done = r.finishedAt !== null;
  const spinning = r.spinT > 0;
  r.spinT = Math.max(0, r.spinT - dt);
  r.turboT = Math.max(0, r.turboT - dt);
  r.boostT = Math.max(0, r.boostT - dt);

  // steering: smoothed, weaker in the air and while spinning
  const want = spinning ? 0 : Math.max(-1, Math.min(1, inp.steer));
  r.steer += (want - r.steer) * Math.min(1, dt * 9);

  // drifting: start with DRIFT held while steering (or already sliding), end on release
  const driftHeld = !done && !spinning && inp.drift;
  if (!r.drift && driftHeld && !r.air && r.v > 12 && Math.abs(r.steer) > 0.2) {
    r.drift = Math.sign(r.steer);
    r.driftT = 0;
    r.stats.drifts++;
    out.push({ kind: "driftStart", id: r.id, dir: r.drift });
  }
  if (r.drift && (!driftHeld || r.v < 8)) {
    const lvl = driftLevel(r);
    if (lvl > 0 && driftHeld === false && r.v >= 8) {
      const tb = TURBO[lvl - 1]!;
      r.turboT = tb.t;
      r.turboPower = tb.power;
      r.stats.turbos[lvl - 1]!++;
      out.push({ kind: "turbo", id: r.id, level: lvl as 1 | 2 | 3 });
    }
    r.drift = 0;
    r.driftT = 0;
  }
  if (r.drift) {
    const before = driftLevel(r);
    const into = Math.max(0, r.steer * r.drift);
    r.driftT += dt * (r.air ? 0.3 : 0.85 + 0.5 * into);
    const after = driftLevel(r);
    if (after > before) out.push({ kind: "driftLevel", id: r.id, level: after as 1 | 2 | 3 });
    r.meter = Math.min(1, r.meter + dt * 0.035);
  }

  // speed: auto-gas towards this racer's current top speed
  const vt = done ? k.vmax * 0.55 : spinning ? 4 : topSpeed(r);
  if (r.v < vt) r.v += k.accel * (1 - (r.v / vt) * 0.85) * dt * (r.air ? 0.2 : 1);
  else r.v -= (r.v - vt) * Math.min(1, dt * (spinning ? 2.5 : 1.2));
  if (Math.abs(r.a) > 0.9) r.v *= Math.exp(-1.2 * dt); // sideways scrubs speed
  r.stats.topSpeed = Math.max(r.stats.topSpeed, r.v);

  // yaw relative to the road
  frameAt(t, r.s, fr);
  const sv = (r.v * Math.cos(r.a)) / Math.max(0.35, 1 + fr.curv * r.d);
  const grip = r.air ? 0.25 : 1;
  let yaw: number;
  if (r.drift) {
    const into = r.steer * r.drift; // -1 counter-steer … 1 full into the drift
    yaw = r.drift * (DRIFT_YAW[0] + DRIFT_YAW[1] * (into + 1)) * grip;
    r.slip += (r.drift * 0.42 - r.slip) * Math.min(1, dt * 6);
  } else {
    const speedFactor = 0.55 + 0.45 * Math.min(1, r.v / 10);
    yaw = r.steer * k.turn * speedFactor * grip;
    r.slip += (r.steer * 0.08 - r.slip) * Math.min(1, dt * 8);
  }
  if (spinning) {
    yaw = 0;
    r.a *= Math.exp(-2 * dt);
  }
  r.a += (yaw + (1 - ASSIST) * fr.curv * sv) * dt;
  // a straight-line pull back towards the road direction when not steering (phones are imprecise)
  if (!r.drift && Math.abs(r.steer) < 0.15) r.a *= Math.exp(-1.1 * dt);
  r.a = Math.max(-1.25, Math.min(1.25, r.a));

  // move
  r.sv = sv;
  r.s += sv * dt;
  r.push *= Math.exp(-3.2 * dt);
  const lat = r.v * Math.sin(r.a) + r.push;
  r.d += lat * dt;

  // rails
  frameAt(t, r.s, fr);
  const lim = fr.hw - k.wid / 2 - 0.15;
  if (Math.abs(r.d) > lim) {
    const side = Math.sign(r.d);
    const impact = Math.max(0, lat * side);
    r.d = side * lim;
    if (impact > 0.5) {
      r.push = -side * impact * 0.35;
      r.a *= 0.4;
      r.v *= 1 - 0.12 * Math.min(1, impact / 9);
      if (r.drift && impact > 3) {
        r.drift = 0;
        r.driftT = 0;
      }
      r.stats.rails++;
      out.push({ kind: "wall", id: r.id, impact, side });
    }
  }

  // vertical: stick to the road unless it falls away faster than gravity can follow (a crest) → fly
  const gy = fr.y;
  if (!r.air) {
    const ahead = frameAt(t, r.s + 2, fr2).slope;
    const ydd = ((ahead - fr.slope) / 2) * sv * sv;
    r.vy = sv * fr.slope;
    r.y = gy;
    if (ydd < -G * 0.85 && sv > 14) {
      r.air = true;
      r.airT = 0;
    }
  }
  if (r.air) {
    r.vy -= G * dt;
    r.y += r.vy * dt;
    if (r.airT < 0.25 && r.airT + dt >= 0.25) out.push({ kind: "air", id: r.id }); // a real jump, not a bump
    r.airT += dt;
    r.stats.air += dt;
    r.meter = Math.min(1, r.meter + dt * 0.12);
    if (r.y <= gy) {
      const impact = Math.max(0, sv * fr.slope - r.vy);
      if (r.airT >= 0.25) out.push({ kind: "land", id: r.id, airT: r.airT, impact });
      r.y = gy;
      r.air = false;
      r.airT = 0;
    }
  }

  if (inp.boost && tryBoost(r)) out.push({ kind: "boost", id: r.id });
}

/** Spins a racer out (coconut, goat, splash wave): no steering for a moment, speed scrubbed. */
export function spinOut(r: Racer, seconds = SPIN_TIME) {
  if (r.shieldT > 0 || r.wreckT > 0) return false;
  r.spinT = Math.max(r.spinT, seconds);
  r.drift = 0;
  r.driftT = 0;
  r.boostT = 0;
  r.turboT = 0;
  return true;
}

/** Wrecks a racer (takedown or crash): a short tumble, then the race respawns it. */
export function wreck(r: Racer) {
  if (r.shieldT > 0 || r.wreckT > 0) return false;
  r.wreckT = WRECK_TIME;
  r.drift = 0;
  r.driftT = 0;
  r.boostT = 0;
  r.turboT = 0;
  r.spinT = 0;
  return true;
}
