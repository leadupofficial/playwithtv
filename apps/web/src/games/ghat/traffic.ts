/**
 * Ghat-road hazards: buses and lorries (some climbing with you in the left lane, some coming down at you in the
 * right lane, India-style) and goats that wander across the tea-estate stretch. Near misses fill the boost
 * meter; hitting a vehicle wrecks you; hitting a goat spins you out (the goat is fine, just offended). Pure.
 */
import { frameAt, wrapS, type Frame, type Track } from "./track";

export type TrafficKind = "bus" | "lorry";
export const TRAFFIC_SIZE: Record<TrafficKind, { len: number; wid: number }> = {
  bus: { len: 9.6, wid: 2.5 },
  lorry: { len: 7.2, wid: 2.4 },
};

export interface Traffic {
  id: number;
  kind: TrafficKind;
  /** Position on the lap (wrapped 0..length). */
  s: number;
  d: number;
  v: number;
  /** 1 = same direction as the race, -1 = oncoming. */
  dir: 1 | -1;
  lane: number;
  /** Seconds left of pulling over (goat-horn). */
  verge: number;
  /** Visual tint index. */
  look: number;
}

export interface Goat {
  id: number;
  s: number;
  d: number;
  /** Lateral walking speed (m/s, signed). */
  vd: number;
  /** Pauses mid-road to stare at you. */
  pause: number;
  /** Seconds since bumped (> 0 = flying off comically), 0 = walking. */
  bumped: number;
  fleeing: boolean;
  hop: number;
  dodged: Set<string>;
}

const fr: Frame = { x: 0, y: 0, z: 0, heading: 0, curv: 0, slope: 0, hw: 0, i: 0 };

/** Spreads traffic round the lap, none on the start grid. Half climb with you, half come down at you. */
export function spawnTraffic(t: Track, count: number, rnd: () => number): Traffic[] {
  const out: Traffic[] = [];
  const clear = 170; // metres after the start line kept free at the start
  for (let i = 0; i < count; i++) {
    const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const s = clear + ((t.length - clear - 60) * (i + 0.3 + rnd() * 0.4)) / count;
    out.push({ id: i, kind: rnd() < 0.5 ? "bus" : "lorry", s, d: 0, v: 13 + rnd() * 4, dir, lane: dir === 1 ? -0.48 : 0.48, verge: 0, look: Math.floor(rnd() * 4) });
  }
  for (const c of out) c.d = c.lane * frameAt(t, c.s, fr).hw;
  return out;
}

/** Moves traffic along its lane: slower in hairpins, pulled over to the verge after a horn blast. */
export function stepTraffic(t: Track, list: Traffic[], dt: number) {
  for (const c of list) {
    frameAt(t, c.s, fr);
    const corner = Math.min(1, Math.sqrt(3.2 / Math.max(1e-3, Math.abs(fr.curv))) / c.v);
    const v = c.v * Math.max(0.45, corner) * (c.verge > 0 ? 0.4 : 1);
    c.s = wrapS(t, c.s + c.dir * v * dt);
    c.verge = Math.max(0, c.verge - dt);
    const size = TRAFFIC_SIZE[c.kind];
    const target = c.verge > 0 ? Math.sign(c.lane) * (fr.hw - size.wid / 2 - 0.2) : c.lane * fr.hw;
    c.d += (target - c.d) * Math.min(1, dt * (c.verge > 0 ? 2.5 : 1));
  }
}

/** Signed gap from a (racer, unwrapped s) to a wrapped position, in (-L/2, L/2]. */
export function gapTo(t: Track, from: number, to: number): number {
  let g = wrapS(t, to) - wrapS(t, from);
  if (g > t.length / 2) g -= t.length;
  if (g <= -t.length / 2) g += t.length;
  return g;
}

/** Goat zones: where herds cross (fractions of the lap). */
export const GOAT_ZONES = [0.06, 0.66, 0.74, 0.86];

export function spawnGoats(t: Track, at: number, rnd: () => number, nextId: number): Goat[] {
  const s = wrapS(t, at);
  const hw = frameAt(t, s, fr).hw;
  const side = rnd() < 0.5 ? -1 : 1;
  const n = 2 + Math.floor(rnd() * 2);
  const out: Goat[] = [];
  for (let k = 0; k < n; k++) {
    out.push({
      id: nextId + k, s: s + k * 2.2 + rnd() * 1.5, d: side * (hw + 1.5 + k * 1.2), vd: -side * (1.3 + rnd() * 0.6),
      pause: rnd() < 0.5 ? 0.4 + rnd() * 1.2 : 0, bumped: 0, fleeing: false, hop: 0, dodged: new Set(),
    });
  }
  return out;
}

/** Walks goats across (with stubborn pauses); bumped goats tumble away and leave. Returns goats still around. */
export function stepGoats(t: Track, list: Goat[], dt: number): Goat[] {
  for (const g of list) {
    g.hop = Math.max(0, g.hop - dt);
    if (g.bumped > 0) {
      g.bumped += dt;
      g.d += Math.sign(g.vd || 1) * 6 * dt;
      continue;
    }
    const hw = frameAt(t, g.s, fr).hw;
    if (g.pause > 0 && Math.abs(g.d) < hw * 0.6 && !g.fleeing) {
      g.pause -= dt;
      continue;
    }
    g.d += g.vd * (g.fleeing ? 3 : 1) * dt;
  }
  return list.filter((g) => (g.bumped === 0 || g.bumped < 2.2) && Math.abs(g.d) < frameAt(t, g.s, fr).hw + 6);
}
