/**
 * Bowling lane physics, pure (no DOM). Units are metres and seconds; x is across the lane (right +), y runs from
 * the foul line (0) towards the pins. The ball and the pins are discs on the lane surface: the ball skids on
 * the oiled front of the lane and hooks on the dry back end by its spin; pins scatter and knock each other
 * over. A small seeded jitter (pin spots, bounciness) keeps every rack a little different, like the real thing.
 */

export const LANE_HALF = 0.527;      // lane half-width (41.5 in)
export const GUTTER_X = 0.64;        // where a gutter ball runs
export const KICKBACK = 0.76;        // side walls beside the pin deck
export const HEAD = 18.288;          // head pin, 60 ft from the foul line
export const ROW = 0.2639;           // pin rows (10.39 in apart)
export const SPACING = 0.3048;       // pins in a row (12 in apart)
export const PIT_Y = HEAD + 3 * ROW + 0.3;
export const OIL_END = 12.2;         // oil pattern length (40 ft)
export const BALL_R = 0.108;
export const PIN_R = 0.06;
export const PIN_H = 0.38;
const LYING_R = 0.075;               // a fallen pin sweeps a little more than a standing one
const BALL_M = 7;
const PIN_M = 1.5;
const FALL_V = 0.42;                 // a standing pin knocked faster than this falls over
const HOOK = 0.45;                   // lateral acceleration on the dry back end at full spin (m/s²)
const SUBSTEPS = 10;
export const MAX_TIME = 11;

export interface Shot {
  /** Release point across the lane (m). */
  x: number;
  /** Launch direction, radians from straight down the lane (right +). */
  angle: number;
  /** Ball speed, m/s (about 5.5 slow … 9 fast). */
  speed: number;
  /** Hook: -1 curves left, +1 curves right, 0 straight. */
  spin: number;
}

export interface Ball {
  x: number; y: number; vx: number; vy: number; spin: number;
  gutter: boolean; done: boolean; thrown: boolean;
  /** Rolled distance, for drawing the ball's turning finger holes. */
  rolled: number;
  touched: Set<number>;
}

export interface Pin {
  /** Pin number 1–10 (1 = head pin, 7 back left, 10 back right). */
  n: number;
  x: number; y: number; vx: number; vy: number;
  /** Height off the deck and vertical speed (pins hop when they are hit hard). */
  z: number; vz: number;
  /** 0 standing … π/2 lying; the direction it falls towards. */
  tilt: number; dir: number;
  standing: boolean;
  /** Fell into the pit or off the deck. */
  gone: boolean;
  /** Not in play for this ball (knocked down by an earlier ball of the frame). */
  cleared: boolean;
}

export type LaneEvent =
  | { kind: "pin-hit"; speed: number; byBall: boolean }
  | { kind: "gutter" }
  | { kind: "pit" };

export interface Lane {
  ball: Ball;
  pins: Pin[];
  t: number;
  /** Time since the ball reached the pins (or the end of the lane). */
  after: number;
  settled: boolean;
  seed: number;
}

/** Pin spots: rows from the head pin back, left to right as the bowler sees them. */
export function pinSpot(n: number): { x: number; y: number } {
  const rows = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10]];
  for (let r = 0; r < 4; r++) {
    const i = rows[r]!.indexOf(n);
    if (i >= 0) return { x: (i - r / 2) * SPACING, y: HEAD + r * ROW };
  }
  throw new Error(`no pin ${n}`);
}

function rng(lane: Lane) {
  lane.seed = (lane.seed * 16807) % 2147483647;
  return lane.seed / 2147483647;
}

const newBall = (): Ball => ({ x: 0, y: -0.4, vx: 0, vy: 0, spin: 0, gutter: false, done: false, thrown: false, rolled: 0, touched: new Set() });

export function newLane(seed = 1): Lane {
  const lane: Lane = { ball: newBall(), pins: [], t: 0, after: 0, settled: false, seed: (Math.abs(Math.floor(seed)) % 2147483646) + 1 };
  rack(lane);
  return lane;
}

/** A fresh rack of ten pins on their spots (with a few millimetres of seeded jitter). */
export function rack(lane: Lane) {
  lane.pins = [];
  for (let n = 1; n <= 10; n++) {
    const s = pinSpot(n);
    const jx = (rng(lane) - 0.5) * 0.014, jy = (rng(lane) - 0.5) * 0.014;
    lane.pins.push({ n, x: s.x + jx, y: s.y + jy, vx: 0, vy: 0, z: 0, vz: 0, tilt: 0, dir: 0, standing: true, gone: false, cleared: false });
  }
  lane.ball = newBall();
  lane.t = lane.after = 0;
  lane.settled = false;
}

/** Second ball of a frame: knocked pins are swept away, standing pins stay where they ended up. */
export function sweep(lane: Lane) {
  for (const p of lane.pins) {
    if (!p.standing || p.gone || Math.abs(p.x) > LANE_HALF) p.cleared = true;
    p.vx = p.vy = p.vz = p.z = 0;
  }
  lane.ball = newBall();
  lane.t = lane.after = 0;
  lane.settled = false;
}

export function throwBall(lane: Lane, shot: Shot) {
  const b = lane.ball;
  const x = Math.max(-LANE_HALF + BALL_R, Math.min(LANE_HALF - BALL_R, shot.x));
  Object.assign(b, { x, y: 0, vx: Math.sin(shot.angle) * shot.speed, vy: Math.cos(shot.angle) * shot.speed, spin: Math.max(-1, Math.min(1, shot.spin)), thrown: true });
}

/** Pins knocked down (or off the deck) by the ball in play, among those that were standing before it. */
export function knocked(lane: Lane): number {
  return lane.pins.filter((p) => !p.cleared && (!p.standing || p.gone || Math.abs(p.x) > LANE_HALF)).length;
}

export function standingCount(lane: Lane): number {
  return lane.pins.filter((p) => !p.cleared && p.standing && !p.gone && Math.abs(p.x) <= LANE_HALF).length;
}

function hookFactor(y: number) {
  if (y < OIL_END) return 0.1;
  return Math.min(1, 0.1 + (y - OIL_END) / 1.6);
}

function collide(
  ax: { x: number; y: number; vx: number; vy: number }, am: number, ar: number,
  bx: { x: number; y: number; vx: number; vy: number }, bm: number, br: number, e: number,
): number {
  const dx = bx.x - ax.x, dy = bx.y - ax.y;
  const rr = ar + br;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return 0;
  const d = Math.sqrt(d2);
  const nx = dx / d, ny = dy / d;
  // push apart in proportion to inverse mass
  const overlap = rr - d;
  const ia = 1 / am, ib = 1 / bm;
  ax.x -= nx * overlap * (ia / (ia + ib)); ax.y -= ny * overlap * (ia / (ia + ib));
  bx.x += nx * overlap * (ib / (ia + ib)); bx.y += ny * overlap * (ib / (ia + ib));
  const rel = (ax.vx - bx.vx) * nx + (ax.vy - bx.vy) * ny;
  if (rel <= 0) return 0;
  const j = ((1 + e) * rel) / (ia + ib);
  ax.vx -= j * ia * nx; ax.vy -= j * ia * ny;
  bx.vx += j * ib * nx; bx.vy += j * ib * ny;
  return rel;
}

function fall(lane: Lane, p: Pin, speed: number) {
  if (!p.standing) return;
  p.standing = false;
  p.dir = Math.atan2(p.vy, p.vx);
  p.vz = Math.min(1.6, speed * (0.15 + rng(lane) * 0.3));
}

/** Advances the lane by dt seconds (use 1/60). Returns what happened, for sound and effects. */
export function stepLane(lane: Lane, dt: number): LaneEvent[] {
  const ev: LaneEvent[] = [];
  if (lane.settled) return ev;
  const b = lane.ball;
  const h = dt / SUBSTEPS;
  for (let s = 0; s < SUBSTEPS; s++) {
    // ball
    if (b.thrown && !b.done) {
      if (!b.gutter) {
        b.vx += b.spin * HOOK * hookFactor(b.y) * h;
        const v = Math.hypot(b.vx, b.vy);
        const slow = (b.y < OIL_END ? 0.1 : 0.3) * h;
        if (v > slow) { b.vx *= 1 - slow / v; b.vy *= 1 - slow / v; }
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.rolled += Math.hypot(b.vx, b.vy) * h;
      if (!b.gutter && Math.abs(b.x) > LANE_HALF) {
        b.gutter = true;
        b.x = Math.sign(b.x) * GUTTER_X;
        b.vx = 0;
        ev.push({ kind: "gutter" });
      }
      if (b.y > PIT_Y || b.vy <= 0.05) {
        b.done = true;
        ev.push({ kind: "pit" });
      }
    }
    // pins
    for (const p of lane.pins) {
      if (p.cleared || p.gone) continue;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 0) {
        const decel = (p.standing ? 6 : p.z > 0 ? 0.3 : 2.2) * h;
        if (v <= decel) p.vx = p.vy = 0;
        else { p.vx *= 1 - decel / v; p.vy *= 1 - decel / v; }
      }
      p.x += p.vx * h;
      p.y += p.vy * h;
      if (!p.standing) {
        p.tilt = Math.min(Math.PI / 2, p.tilt + 9 * h);
        if (p.z > 0 || p.vz > 0) { p.z += p.vz * h; p.vz -= 9.81 * h; if (p.z <= 0) { p.z = 0; p.vz = 0; } }
      }
      // side kickbacks send pins back across the deck; the pit swallows them
      if (Math.abs(p.x) > KICKBACK - PIN_R && p.vx * p.x > 0) { p.vx = -p.vx * 0.45; p.x = Math.sign(p.x) * (KICKBACK - PIN_R); }
      if (p.y > PIT_Y || p.y < HEAD - 2) p.gone = true;
      if (!p.standing && Math.abs(p.x) > LANE_HALF + 0.03 && v < 0.6 && p.z === 0) p.gone = true;
    }
    // ball against pins
    if (b.thrown && !b.done && !b.gutter && b.y > HEAD - 1) {
      for (const p of lane.pins) {
        if (p.cleared || p.gone || p.z > 0.25) continue;
        const r = collide(b, BALL_M, BALL_R, p, PIN_M, p.standing ? PIN_R : LYING_R, 0.55 + rng(lane) * 0.1);
        if (r > 0) {
          b.touched.add(p.n);
          if (r > 0.4) ev.push({ kind: "pin-hit", speed: r, byBall: true });
          if (Math.hypot(p.vx, p.vy) > FALL_V) fall(lane, p, r);
        }
      }
    }
    // pins against pins
    const ps = lane.pins;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i]!;
      if (a.cleared || a.gone) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j]!;
        if (c.cleared || c.gone || Math.abs(a.z - c.z) > 0.25) continue;
        if (a.vx === 0 && a.vy === 0 && c.vx === 0 && c.vy === 0) continue;
        const r = collide(a, PIN_M, a.standing ? PIN_R : LYING_R, c, PIN_M, c.standing ? PIN_R : LYING_R, 0.5 + rng(lane) * 0.15);
        if (r > 0) {
          if (r > 0.4) ev.push({ kind: "pin-hit", speed: r, byBall: false });
          if (Math.hypot(a.vx, a.vy) > FALL_V) fall(lane, a, r);
          if (Math.hypot(c.vx, c.vy) > FALL_V) fall(lane, c, r);
        }
      }
    }
  }
  lane.t += dt;
  if (b.thrown && (b.done || b.y > HEAD - 0.3)) lane.after += dt;
  const moving = lane.pins.some((p) => !p.cleared && !p.gone && (Math.hypot(p.vx, p.vy) > 0.03 || (!p.standing && p.tilt < Math.PI / 2) || p.z > 0));
  if ((b.done && !moving && lane.after > 0.8) || lane.t > MAX_TIME) lane.settled = true;
  return ev;
}

/** Runs a whole ball to rest (for tests and the CPU-free simulations). */
export function simulate(lane: Lane, shot: Shot): number {
  throwBall(lane, shot);
  while (!lane.settled) stepLane(lane, 1 / 60);
  return knocked(lane);
}

/** Where a ball would roll (no pins), sampled every `dy` metres, for the aiming guide. */
export function previewPath(shot: Shot, toY: number, dy = 0.5): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  let x = shot.x, y = 0, vx = Math.sin(shot.angle) * shot.speed, vy = Math.cos(shot.angle) * shot.speed;
  const h = 1 / 240;
  let next = 0;
  while (y < toY && vy > 0.05) {
    if (y >= next) { out.push({ x, y }); next += dy; }
    vx += shot.spin * HOOK * hookFactor(y) * h;
    x += vx * h;
    y += vy * h;
    if (Math.abs(x) > LANE_HALF) { out.push({ x: Math.sign(x) * LANE_HALF, y }); break; }
  }
  return out;
}
