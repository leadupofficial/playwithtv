/**
 * Penalty geometry, pure (no DOM). Metres, in the goal plane: x right of the goal's centre, y up from the
 * ground. The ball flies from the spot (11 m out) to the goal line; the keeper is a capsule (body plus
 * reach) that moves along a dive.
 */
export const HALF_W = 3.66;          // half the goal's width (7.32 m between the posts' inner edges)
export const GOAL_H = 2.44;
export const BALL_R = 0.11;
export const POST_R = 0.06;
export const SPOT = 11;
/** Normalised aim 1 = this far from the centre (a little outside the posts / above the bar). */
export const AIM_X = 4.1;
export const AIM_Y = 2.75;
/** Time for a dive to reach full stretch. */
export const DIVE_TIME = 0.42;
/** How far the keeper's body centre travels on a full sideways dive. */
export const DIVE_REACH = 2.05;

export interface Vec { x: number; y: number }
/** A keeper's dive: dx -1 (left) … 1 (right), dy -1 (low) … 1 (high). {0, 1} is a jump. */
export interface Dive { dx: number; dy: number }
export interface Capsule { a: Vec; b: Vec; r: number }
export interface Shot {
  target: Vec;   // where the ball crosses the goal line (after power error and swerve)
  power: number; // 0.2 … 1.3 (above 1 = overhit)
  curve: number; // -1 … 1: positive swerves to the right late in the flight
  time: number;  // seconds from the kick to the goal line
}
export type Outcome = "goal" | "save" | "post" | "bar" | "wide" | "over";

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Normalised aim (x -1…1, y 0…1) to a point in the goal plane. */
export function aimToGoal(ax: number, ay: number): Vec {
  return { x: clamp(ax, -1.15, 1.15) * AIM_X, y: Math.max(BALL_R, clamp(ay, 0, 1.15) * AIM_Y) };
}

/** Flight time: a soft shot takes 0.9 s, a full-power one 0.5 s. */
export const flightTime = (power: number) => 1 - 0.5 * clamp(power, 0, 1);

/** Normal-distributed noise from a uniform generator (Box-Muller). */
function gauss(rand: () => number) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * A kick. Accuracy falls off above 85% power; overhitting (power > 1) lifts the ball, so a fully charged
 * shot sails over the bar. Curve moves where the ball ends up, late in the flight.
 */
export function makeShot(aim: Vec, power: number, curve: number, rand: () => number): Shot {
  const p = clamp(power, 0.2, 1.3);
  const c = clamp(curve, -1, 1);
  const spread = 0.06 + 0.45 * Math.max(0, p - 0.85);
  const lift = Math.max(0, p - 1) * 5;
  const target = {
    x: aim.x + c * 0.9 + gauss(rand) * spread,
    y: Math.max(BALL_R, aim.y + lift + gauss(rand) * spread * 0.7),
  };
  return { target, power: p, curve: c, time: flightTime(p) };
}

/** The ball `u` (0 … 1) of the way through its flight; `dist` is metres from the goal line. */
export function ballAt(s: Shot, u: number): Vec & { dist: number } {
  const k = clamp(u, 0, 1);
  const loft = 0.55 * (1 - Math.min(1, s.power));
  return {
    x: s.target.x * k - s.curve * 1.6 * k * (1 - k), // starts away from the swerve, bends back in
    y: BALL_R + (s.target.y - BALL_R) * k + loft * Math.sin(Math.PI * k),
    dist: SPOT * (1 - k),
  };
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** The keeper `tau` seconds into a dive (null dive = standing tall in the middle, arms out). */
export function keeperBody(dive: Dive | null, tau: number): Capsule {
  if (!dive || tau <= 0) return { a: { x: 0, y: 0.15 }, b: { x: 0, y: 1.95 }, r: 0.42 };
  const p = easeOut(clamp(tau / DIVE_TIME, 0, 1));
  const dx = clamp(dive.dx, -1, 1), dy = clamp(dive.dy, -1, 1);
  const side = Math.abs(dx) > 0.2;
  const c = { x: dx * DIVE_REACH * p, y: 1.05 + (side ? dy * 0.62 : Math.max(0, dy) * 0.55) * p };
  // the body tips from upright towards the dive direction (a jump stays upright)
  const target = side ? Math.atan2(0.25 + dy * 0.35, dx) : Math.PI / 2;
  const from = Math.PI / 2;
  let delta = target - from;
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const ang = from + delta * p;
  const half = 0.95;
  const ax = Math.cos(ang) * half, ay = Math.sin(ang) * half;
  return { a: { x: c.x - ax, y: c.y - ay }, b: { x: c.x + ax, y: c.y + ay }, r: 0.42 - 0.1 * p * Math.abs(dx) };
}

/** Distance from point p to segment a–b. */
export function segDist(p: Vec, a: Vec, b: Vec): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

const PX = HALF_W + POST_R;   // post centre lines
const BY = GOAL_H + POST_R;   // crossbar centre line

/**
 * Where the ball ends up when it reaches the goal line. A keeper touch is a save; a ball that clips a post
 * or the bar but is inside the frame goes in off the woodwork; one that hits the outside of the frame is
 * "post" / "bar"; anything else outside is wide or over.
 */
export function resolve(ball: Vec, keeper: Capsule): { outcome: Outcome; woodwork: boolean } {
  if (segDist(ball, keeper.a, keeper.b) <= keeper.r + BALL_R) return { outcome: "save", woodwork: false };
  const hit = BALL_R + POST_R;
  const left = segDist(ball, { x: -PX, y: 0 }, { x: -PX, y: BY }) <= hit;
  const right = segDist(ball, { x: PX, y: 0 }, { x: PX, y: BY }) <= hit;
  const bar = segDist(ball, { x: -PX, y: BY }, { x: PX, y: BY }) <= hit;
  const inside = Math.abs(ball.x) < HALF_W && ball.y < GOAL_H;
  if (inside) return { outcome: "goal", woodwork: left || right || bar };
  if (left || right) return { outcome: "post", woodwork: true };
  if (bar) return { outcome: "bar", woodwork: true };
  return { outcome: ball.y >= GOAL_H ? "over" : "wide", woodwork: false };
}
