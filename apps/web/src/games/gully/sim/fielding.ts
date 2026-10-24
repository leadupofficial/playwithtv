/**
 * After the bat: the ball's flight down the lane (drag, bounces, house walls, balconies, the neighbours' windows,
 * the boundary) and the automatic fielders: catches, the gully's "one tip, one hand" catch after a single bounce,
 * ground fielding, the throw and the runs, with the odd run-out. Pure: one random source in, one Play out.
 */
import { FIELD_SPOTS, G, LANE, clamp } from "./lane";
import { BALL_R, type Vec } from "./delivery";

export const PLAY_HZ = 60;
const DRAG = 0.0075;           // quadratic air drag (tennis-taped ball)
const ROLL_DECEL = 2.2;        // m/s² on the lane's rough concrete
const REACT = 0.35;            // s before a fielder moves
const RUN_SPEED = 5.4;         // m/s, kids sprinting
const REACH = 0.65;            // m, arms and a lunge
const CATCH_HEIGHT = 2.2;
const RUN_TIME = 1.7;          // s per run between the brick stack and the bowler's end
const THROW_SPEED = 21;

export type PlayKind = "six" | "four" | "window" | "runs" | "caught" | "one-bounce" | "runout" | "dot";

export interface PlayEvent { t: number; kind: "bounce" | "wall" | "window" | "balcony" | "roof" | "boundary" | "catch" | "drop" | "field" | "stop"; at: Vec; fielder?: number }

export interface Play {
  /** Ball positions every 1/PLAY_HZ s from the bat. */
  path: Vec[];
  events: PlayEvent[];
  kind: PlayKind;
  runs: number;
  /** Runs on top of a six for smashing a window. */
  bonus: number;
  /** Fielder (index into the fielders given) who caught or fielded it, and where they ran to. */
  fielder: number | null;
  fieldAt: Vec | null;
  fieldT: number;
  /** Seconds until the play is over (ball dead, runs done). */
  duration: number;
  /** Bounces before a catch / the boundary. */
  bounces: number;
  /** Where a six landed (or the window it broke), for the camera. */
  landing: Vec | null;
}

export const WINDOW_BONUS = 2;

/** Default fielders: the five spots plus the bowler following through. */
export function defaultFielders(): Vec[] {
  return [...FIELD_SPOTS.map((s) => ({ x: s.x, y: 0, z: s.z })), { x: LANE.release.x + 0.9, y: 0, z: LANE.bowlerCreaseZ + 3.0 }];
}

/** When fielder f could first reach the ball at time t (reach grows as they run). */
const ACCEL = 8;                // m/s² from standing
const T_TOP = RUN_SPEED / ACCEL;
/** Metres run after `s` seconds of running (accelerating, then at top speed). */
export function runDistance(s: number): number {
  if (s <= 0) return 0;
  return s < T_TOP ? 0.5 * ACCEL * s * s : 0.5 * ACCEL * T_TOP * T_TOP + (s - T_TOP) * RUN_SPEED;
}
const reachAt = (t: number) => REACH + runDistance(t - REACT);

export function playOut(p0: Vec, v0: Vec, fielders: Vec[], rand: () => number, opts: { defended?: boolean } = {}): Play {
  const dt = 1 / PLAY_HZ;
  const path: Vec[] = [{ ...p0 }];
  const events: PlayEvent[] = [];
  const p = { ...p0 };
  const v = { ...v0 };
  let bounces = 0, t = 0, rolling = false;
  const beaten = new Set<number>();
  const W = LANE.halfWidth - BALL_R;
  const end = (kind: PlayKind, runs: number, extra: Partial<Play> = {}): Play => ({
    path, events, kind, runs, bonus: 0, fielder: null, fieldAt: null, fieldT: t, duration: t + 1.2, bounces, landing: null, ...extra,
  });

  for (let i = 0; i < PLAY_HZ * 8; i++) {
    t += dt;
    // --- move
    const sp = Math.hypot(v.x, v.y, v.z);
    if (!rolling) {
      v.x -= v.x * sp * DRAG * dt;
      v.z -= v.z * sp * DRAG * dt;
      v.y -= (G + v.y * sp * DRAG) * dt;
    } else {
      const h = Math.hypot(v.x, v.z);
      const k = h > 0 ? Math.max(0, h - ROLL_DECEL * dt) / h : 0;
      v.x *= k;
      v.z *= k;
    }
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    // --- the ground
    if (p.y <= BALL_R) {
      p.y = BALL_R;
      if (!rolling) {
        bounces++;
        events.push({ t, kind: "bounce", at: { ...p } });
        v.y = -v.y * 0.5;
        v.x *= 0.78;
        v.z *= 0.78;
        if (v.y < 1.2) {
          rolling = true;
          v.y = 0;
        }
      }
    }
    // --- the houses
    if (Math.abs(p.x) >= W) {
      const side = Math.sign(p.x);
      p.x = side * W;
      if (bounces === 0 && p.y >= LANE.roofY) {
        events.push({ t, kind: "roof", at: { ...p } });
        path.push({ ...p });
        return end("six", 6, { landing: { ...p }, duration: t + 2.2 });
      }
      const win = LANE.windows.find((w) => w.side === side && p.z >= w.z0 && p.z <= w.z1 && p.y >= w.y0 && p.y <= w.y1);
      if (bounces === 0 && win) {
        events.push({ t, kind: "window", at: { ...p } });
        path.push({ ...p });
        return end("window", 6, { bonus: WINDOW_BONUS, landing: { ...p }, duration: t + 2.4 });
      }
      if (bounces === 0 && p.y >= LANE.balconyY) {
        events.push({ t, kind: "balcony", at: { ...p } });
        path.push({ ...p });
        return end("six", 6, { landing: { ...p }, duration: t + 2.2 });
      }
      // off the wall: back into the lane, slower
      v.x = -v.x * 0.42;
      v.z *= 0.75;
      events.push({ t, kind: "wall", at: { ...p } });
    }
    // --- behind the keeper: the compound wall
    if (p.z >= LANE.backWallZ - BALL_R) {
      p.z = LANE.backWallZ - BALL_R;
      v.z = -Math.abs(v.z) * 0.35;
      events.push({ t, kind: "wall", at: { ...p } });
    }
    path.push({ ...p });
    // --- the boundary
    if (p.z <= LANE.boundaryZ) {
      events.push({ t, kind: "boundary", at: { ...p } });
      return bounces === 0
        ? end("six", 6, { landing: { ...p }, duration: t + 2 })
        : end("four", 4, { landing: { ...p }, duration: t + 1.6 });
    }
    // --- fielders
    const hit = interceptor(fielders, p, t, beaten);
    if (hit !== null) {
      const f = fielders[hit]!;
      const ballSpeed = Math.hypot(v.x, v.y, v.z);
      const margin = reachAt(t) - Math.hypot(f.x - p.x, f.z - p.z);
      if (bounces === 0 && p.y <= CATCH_HEIGHT && p.y > 0.12) {
        // a catch: easy when they are under it, a dive at full stretch otherwise; a rocket is harder
        let chance = margin > 0.6 ? 0.62 : 0.28;
        if (ballSpeed > 17) chance -= 0.22;
        if (rand() < chance) {
          events.push({ t, kind: "catch", at: { ...p }, fielder: hit });
          return end("caught", 0, { fielder: hit, fieldAt: { ...p }, duration: t + 2 });
        }
        events.push({ t, kind: "drop", at: { ...p }, fielder: hit });
        return fielded(hit, p, t + 0.7, "drop");
      }
      if (bounces === 1 && !rolling && p.y > 0.18 && p.y <= CATCH_HEIGHT) {
        // one tip, one hand: legal out in the gully
        if (rand() < (margin > 0.5 ? 0.6 : 0.35)) {
          events.push({ t, kind: "catch", at: { ...p }, fielder: hit });
          return end("one-bounce", 0, { fielder: hit, fieldAt: { ...p }, duration: t + 2 });
        }
      }
      if (p.y <= 1.0) {
        // a hard-hit ball at full stretch can beat the dive and run on
        if (ballSpeed > 12 && margin < 0.8 && rand() < 0.5) beaten.add(hit);
        else return fielded(hit, p, t, "field");
      }
    }
    if (rolling && Math.hypot(v.x, v.z) < 0.15) break;
  }
  // stopped (or still rolling after 8 s): the nearest fielder walks over
  const near = nearest(fielders, p);
  const walk = REACT + Math.max(0, Math.hypot(fielders[near]!.x - p.x, fielders[near]!.z - p.z) - REACH) / RUN_SPEED;
  events.push({ t, kind: "stop", at: { ...p } });
  return fielded(near, p, Math.max(t, walk), "field");

  function fielded(fi: number, at: Vec, tf: number, kind: "field" | "drop"): Play {
    if (kind === "field") events.push({ t: tf, kind: "field", at: { ...at }, fielder: fi });
    // the throw goes to the nearer end
    const toStumps = Math.hypot(at.x, at.z - LANE.stumps.z);
    const toBowler = Math.hypot(at.x - LANE.release.x, at.z - LANE.bowlerCreaseZ);
    const total = tf + 0.35 + Math.min(toStumps, toBowler) / THROW_SPEED;
    const raw = (total - (opts.defended ? 0.7 : 0.3)) / RUN_TIME;
    let runs = clamp(Math.floor(raw), 0, 3);
    const frac = raw - Math.floor(raw);
    const base = { fielder: fi, fieldAt: { ...at }, fieldT: tf };
    if (runs < 3 && frac > 0.85) {
      // they push for one more…
      if (rand() < 0.25) return end("runout", runs, { ...base, duration: Math.max(total, (runs + 1) * RUN_TIME) + 1.4 });
      runs++;
    }
    return end(runs ? "runs" : "dot", runs, { ...base, duration: Math.max(total, runs * RUN_TIME + 0.4) + 0.9 });
  }
}

function interceptor(fielders: Vec[], p: Vec, t: number, skip: Set<number>): number | null {
  const r = reachAt(t);
  let best: number | null = null, bd = Infinity;
  fielders.forEach((f, i) => {
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (!skip.has(i) && d <= r && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

function nearest(fielders: Vec[], p: Vec): number {
  let best = 0, bd = Infinity;
  fielders.forEach((f, i) => {
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Where a fielder is at time t of a play (running to the ball, or standing). */
export function fielderAt(play: Play, index: number, home: Vec, t: number): { pos: Vec; running: boolean } {
  if (play.fielder !== index || !play.fieldAt) return { pos: home, running: false };
  const target = play.fieldAt;
  const d = Math.hypot(target.x - home.x, target.z - home.z);
  const go = Math.min(d, runDistance(t - REACT));
  const k = d > 0 ? go / d : 0;
  return { pos: { x: home.x + (target.x - home.x) * k, y: 0, z: home.z + (target.z - home.z) * k }, running: t > REACT && go < d };
}
