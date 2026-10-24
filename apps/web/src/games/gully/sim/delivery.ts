/**
 * A delivery: from the bowler's plan (line, length, pace or spin) to the ball's flight down the lane, sampled at
 * 120 Hz. Pure and deterministic for a given random source.
 *
 *   line    -1 (leg side) … 0 (at the stumps) … 1 (off side); beyond ±1.2 is a wide
 *   length  0 (full, a yorker at the toes) … 1 (short, a bouncer)
 */
import { G, LANE, clamp, gauss } from "./lane";

export type BallKind = "pace" | "spin";
export interface Vec { x: number; y: number; z: number }
export interface BowlPlan { line: number; length: number; kind: BallKind }

export const BALL_R = 0.035;
export const SAMPLE_HZ = 120;
const SPEED: Record<BallKind, number> = { pace: 17, spin: 12.5 };
/** Horizontal speed kept after the bounce. */
const GRIP: Record<BallKind, number> = { pace: 0.9, spin: 0.8 };
const BOUNCE_E = 0.5;
/** x at the batter for line = ±1. */
const LINE_X = 0.62;

export interface Delivery {
  plan: BowlPlan;
  /** Positions every 1/SAMPLE_HZ s from the release (t = 0). */
  path: Vec[];
  bounce: Vec;
  tBounce: number;
  /** When the ball reaches the batter's hitting zone (z = LANE.contactZ). */
  tContact: number;
  contact: Vec;
  /** When it reaches the stumps (z = 0), and whether it would hit them. */
  tStumps: number;
  hitsStumps: boolean;
  wide: boolean;
  /** Horizontal speed just before the bat (m/s), for commentary and timing feel. */
  speed: number;
  /** Sideways turn after the bounce (spin), metres at the batter. */
  turn: number;
}

/** Turns a plan into a flight. `scatter` (0 = perfect) adds the bowler's human error. */
export function deliver(plan: BowlPlan, rand: () => number, scatter = 0.05): Delivery {
  const line = clamp(plan.line + gauss(rand) * scatter, -1.6, 1.6);
  const length = clamp(plan.length + gauss(rand) * scatter * 0.8, 0, 1);
  const kind = plan.kind;
  const R = LANE.release;
  const xc = line * LINE_X;
  // spin turns towards the stumps after the bounce (plus a little either way), so it beats the edge or the pad
  const turn = kind === "spin" ? clamp(-Math.sign(xc || 1) * 0.18 + gauss(rand) * 0.08, -0.32, 0.32) : 0;
  const bz = LANE.contactZ - (1.2 + length * 6.2);
  // before the bounce the ball travels towards where it would be at the batter without the turn
  const aimX = xc - turn;
  const k = (bz - R.z) / (LANE.contactZ - R.z);
  const bx = R.x + (aimX - R.x) * k;
  const v = SPEED[kind];
  const d1 = Math.hypot(bx - R.x, bz - R.z);
  const t1 = d1 / v;
  const vy0 = (BALL_R - R.y + (G * t1 * t1) / 2) / t1;
  const vx1 = ((bx - R.x) / d1) * v, vz1 = ((bz - R.z) / d1) * v;

  // after the bounce: towards (xc, contactZ), slower, rebounding up
  const v2 = v * GRIP[kind];
  const d2 = Math.hypot(xc - bx, LANE.contactZ - bz);
  let vx = ((xc - bx) / d2) * v2, vz = ((LANE.contactZ - bz) / d2) * v2;
  let vy = -(vy0 - G * t1) * BOUNCE_E;

  const path: Vec[] = [];
  const dt = 1 / SAMPLE_HZ;
  let t = 0;
  for (; t < t1; t += dt) path.push({ x: R.x + vx1 * t, y: R.y + vy0 * t - (G * t * t) / 2, z: R.z + vz1 * t });
  // integrate from the bounce point onwards (later bounces lose most of their height)
  let p = { x: bx, y: BALL_R, z: bz };
  let tt = t1;
  for (; t < 4 && p.z < LANE.backWallZ; t += dt) {
    const h = t - tt;
    tt = t;
    p = { x: p.x + vx * h, y: p.y + vy * h - (G * h * h) / 2, z: p.z + vz * h };
    vy -= G * h;
    if (p.y < BALL_R) {
      p.y = BALL_R;
      vy = Math.abs(vy) * 0.45;
      vx *= 0.85;
      vz *= 0.85;
    }
    path.push({ ...p });
  }
  const tContact = crossing(path, LANE.contactZ);
  const tStumps = crossing(path, LANE.stumps.z);
  const contact = at(path, tContact);
  const atStumps = at(path, tStumps);
  return {
    plan: { line, length, kind }, path, bounce: { x: bx, y: BALL_R, z: bz }, tBounce: t1, tContact, contact,
    tStumps,
    hitsStumps: Math.abs(atStumps.x) <= LANE.stumps.halfWidth + BALL_R && atStumps.y <= LANE.stumps.height + BALL_R,
    wide: Math.abs(contact.x) > LINE_X * 1.25, speed: Math.hypot(vx, vz), turn,
  };
}

/** First time the path reaches z (linear between samples). */
export function crossing(path: Vec[], z: number): number {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    if (a.z < z && b.z >= z) return (i - 1 + (z - a.z) / (b.z - a.z)) / SAMPLE_HZ;
  }
  return path.length / SAMPLE_HZ;
}

/** Position at time t (seconds since the path's start), interpolated; holds the last sample after the end. */
export function at(path: Vec[], t: number, hz = SAMPLE_HZ): Vec {
  if (!path.length) return { x: 0, y: 0, z: 0 };
  const f = Math.max(0, t * hz);
  const i = Math.min(path.length - 1, Math.floor(f));
  const j = Math.min(path.length - 1, i + 1);
  const k = f - i;
  const a = path[i]!, b = path[j]!;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

/** Words for the bowler's phone and the commentary. */
export function describePlan(p: BowlPlan): { length: string; line: string } {
  const length = p.length < 0.15 ? "Yorker" : p.length < 0.4 ? "Full" : p.length < 0.7 ? "Good length" : "Short";
  const line = Math.abs(p.line) > 1.25 ? "Wide" : p.line > 0.45 ? "Off side" : p.line < -0.45 ? "Leg side" : "At the stumps";
  return { length, line };
}
