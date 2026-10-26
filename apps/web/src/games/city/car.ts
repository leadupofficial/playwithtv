/**
 * CITY RIVALS driving: free arcade handling on the district's streets (no rails, no track spline). Pure.
 *   · gas is automatic; steer turns harder at low speed, a held DRIFT loosens the rear grip and tightens the turn,
 *     and a long drift charges the same three mini-turbo levels as GHAT RUSH
 *   · BOOST spends a third of the meter (filled by coins, drifts, air and near misses)
 *   · kicker ramps launch you off their crest; long air pays boost when you land
 *   · buildings, the fountain and the outer wall are solid: you slide along them, a hard hit is a CRASH (slows you)
 * Axes: x east, z south, y up; yaw 0 faces +z: forward = (sin yaw, cos yaw), right = (−cos yaw, sin yaw).
 */
import { DRIFT_LEVELS, KINDS as GHAT_KINDS, type Kind } from "../ghat/racer";
import { BOUND, onGrass, rampAt, type District } from "./district";

export type { Kind };
export const KINDS: Kind[] = ["auto", "scooter", "car"];

export interface CarStats { label: string; vmax: number; accel: number; turn: number; grip: number; radius: number; mass: number; blurb: string }
/** Same pace, different feel (like GHAT RUSH): the scooter turns tightest, the hatch shoves hardest. */
export const STATS: Record<Kind, CarStats> = {
  auto: { label: "Auto", vmax: 27, accel: 15, turn: 2.35, grip: 9, radius: 1.25, mass: 1, blurb: "All-rounder" },
  scooter: { label: "Scooter", vmax: 27.6, accel: 17, turn: 2.6, grip: 10, radius: 0.95, mass: 0.75, blurb: "Turns tightest" },
  car: { label: "Hatch", vmax: 26.6, accel: 14.4, turn: 2.2, grip: 8, radius: 1.5, mass: 1.35, blurb: "Shoves hardest" },
};
// keep the bodies the same size as the GHAT RUSH models we draw
for (const k of KINDS) STATS[k].radius = Math.max(0.9, GHAT_KINDS[k].len / 2 - 0.05);

export const G = 22;
export const BOOST_COST = 1 / 3;
export const BOOST_TIME = 1.5;
export const BOOST_POWER = 1.4;
export const TURBO = [{ t: 0.5, power: 1.22 }, { t: 0.85, power: 1.3 }, { t: 1.3, power: 1.4 }] as const;
/** Impact speed into a wall that counts as a crash (m/s along the wall normal). */
export const CRASH_SPEED = 11;
/** Seconds of being stuck (barely moving) before the car is put back on the street. */
export const STUCK_TIME = 2.5;

export interface CarInput { steer: number; drift: boolean; boost: boolean; /** CPUs only: ease off. */ brake?: boolean }
export const IDLE: CarInput = { steer: 0, drift: false, boost: false };

export interface Car {
  id: string;
  kind: Kind;
  x: number; y: number; z: number;
  yaw: number;
  /** World velocity (m/s). */
  vx: number; vz: number; vy: number;
  air: boolean;
  airT: number;
  /** Ground-height rise rate last step (m/s), to launch off a crest. */
  rise: number;
  meter: number;
  boostT: number;
  boostPower: number;
  drifting: boolean;
  driftDir: number;
  driftT: number;
  stuckT: number;
  crashT: number;
  steer: number;
  stats: { coins: number; air: number; drifts: number; crashes: number; boosts: number; topKmh: number };
}

export type CarEvent =
  | { kind: "crash"; id: string; speed: number }
  | { kind: "scrape"; id: string }
  | { kind: "launch"; id: string }
  | { kind: "land"; id: string; air: number; big: boolean }
  | { kind: "turbo"; id: string; level: 1 | 2 | 3 }
  | { kind: "boost"; id: string }
  | { kind: "reset"; id: string };

export const fwd = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
/** Right-hand side of a heading (screen right for a camera looking along it). */
export const right = (yaw: number) => ({ x: -Math.cos(yaw), z: Math.sin(yaw) });
export const speedOf = (c: Car) => Math.hypot(c.vx, c.vz);
export const forwardSpeed = (c: Car) => c.vx * Math.sin(c.yaw) + c.vz * Math.cos(c.yaw);
export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function newCar(id: string, kind: Kind, x: number, z: number, yaw: number): Car {
  return {
    id, kind, x, y: 0, z, yaw, vx: 0, vz: 0, vy: 0, air: false, airT: 0, rise: 0, meter: 0, boostT: 0, boostPower: 1,
    drifting: false, driftDir: 0, driftT: 0, stuckT: 0, crashT: 0, steer: 0,
    stats: { coins: 0, air: 0, drifts: 0, crashes: 0, boosts: 0, topKmh: 0 },
  };
}

export function driftLevel(c: Pick<Car, "drifting" | "driftT">): 0 | 1 | 2 | 3 {
  if (!c.drifting) return 0;
  return c.driftT >= DRIFT_LEVELS[2] ? 3 : c.driftT >= DRIFT_LEVELS[1] ? 2 : c.driftT >= DRIFT_LEVELS[0] ? 1 : 0;
}

export function topSpeed(c: Car, grass: boolean): number {
  const s = STATS[c.kind];
  return s.vmax * (c.boostT > 0 ? c.boostPower : 1) * (grass ? 0.62 : 1) * (c.crashT > 0 ? 0.6 : 1);
}

/** Fire a boost if the meter has a third: true when it fired. */
export function tryBoost(c: Car): boolean {
  if (c.meter < BOOST_COST - 1e-6) return false;
  c.meter -= BOOST_COST;
  c.boostT = Math.max(c.boostT, BOOST_TIME);
  c.boostPower = BOOST_POWER;
  c.stats.boosts++;
  // the kick you feel
  const f = fwd(c.yaw);
  c.vx += f.x * 4;
  c.vz += f.z * 4;
  return true;
}

export function addMeter(c: Car, v: number) {
  c.meter = Math.min(1, c.meter + v);
}

/** One step of one car (no car-to-car contact: see `bump`). `pace` scales top speed (CPUs < 1). */
/** Where events go: any array of a wider event union will do. */
export interface Sink { push(...e: CarEvent[]): number }

export function drive(d: District, c: Car, inp: CarInput, dt: number, out: Sink, pace = 1): void {
  const s = STATS[c.kind];
  c.steer += (Math.max(-1, Math.min(1, inp.steer)) - c.steer) * (1 - Math.exp(-dt * 14));
  c.boostT = Math.max(0, c.boostT - dt);
  c.crashT = Math.max(0, c.crashT - dt);
  if (inp.boost && !c.air && tryBoost(c)) out.push({ kind: "boost", id: c.id });
  const f = fwd(c.yaw), r = right(c.yaw);
  let fs = c.vx * f.x + c.vz * f.z;
  let ls = c.vx * r.x + c.vz * r.z;
  const grass = onGrass(d, c.x, c.z);
  if (c.air) {
    c.airT += dt;
    c.vy -= G * dt;
    // a little air control, so a jump can be lined up
    c.yaw -= c.steer * s.turn * 0.25 * dt;
  } else {
    // drifting: needs speed and a direction (the steer when the button went down)
    const wantDrift = inp.drift && fs > 9;
    if (wantDrift && !c.drifting && Math.abs(c.steer) > 0.2) {
      c.drifting = true;
      c.driftDir = Math.sign(c.steer);
      c.driftT = 0;
    }
    if (c.drifting && (!wantDrift || fs < 7)) {
      const lvl = driftLevel(c);
      c.drifting = false;
      if (lvl > 0) {
        const t = TURBO[lvl - 1]!;
        if (c.boostT < t.t) {
          c.boostT = t.t;
          c.boostPower = t.power;
        } else c.boostPower = Math.max(c.boostPower, t.power);
        c.stats.drifts++;
        out.push({ kind: "turbo", id: c.id, level: lvl as 1 | 2 | 3 });
      }
    }
    const top = topSpeed(c, grass) * pace * (inp.brake ? 0.55 : 1);
    if (fs < top) fs += s.accel * (1 - Math.max(0, fs) / Math.max(1, top) * 0.55) * dt;
    else fs += (top - fs) * (1 - Math.exp(-dt * (inp.brake ? 3 : 1.6)));
    // turning: tighter at low speed (city corners at full gas still work), a drift turns harder towards its side
    const v = Math.abs(fs);
    const lowSpeed = Math.min(1, v / 6);
    let rate = c.steer * s.turn * lowSpeed * (1.15 - Math.min(0.35, v / 90));
    if (c.drifting) {
      c.driftT += dt;
      const into = c.steer * c.driftDir;
      rate = c.driftDir * s.turn * (0.75 + 0.45 * (into + 1) / 2);
      if (Math.abs(c.steer) > 0.2) c.driftT += dt * 0.25 * Math.max(0, into);
    }
    c.yaw -= rate * dt * Math.sign(fs || 1);
    // grip: the sideways slip dies away (slowly while drifting: the tail hangs out)
    ls *= Math.exp(-dt * (c.drifting ? 2.2 : grass ? s.grip * 0.6 : s.grip));
    if (c.drifting) fs -= 2.2 * dt; // a drift scrubs a little speed
  }
  const f2 = fwd(c.yaw), r2 = right(c.yaw);
  c.vx = f2.x * fs + r2.x * ls;
  c.vz = f2.z * fs + r2.z * ls;
  c.x += c.vx * dt;
  c.z += c.vz * dt;
  // ground (ramps) and air
  const g = rampAt(d, c.x, c.z).h;
  if (c.air) {
    c.y += c.vy * dt;
    if (c.y <= g) {
      c.y = g;
      c.air = false;
      const big = c.airT > 0.7;
      c.stats.air += c.airT;
      if (c.airT > 0.35) addMeter(c, Math.min(0.3, c.airT * 0.2));
      out.push({ kind: "land", id: c.id, air: c.airT, big });
      c.vy = 0;
      c.rise = 0;
    }
  } else {
    const rise = (g - c.y) / dt;
    if (c.rise > 2 && rise < c.rise * 0.2 && fs > 8) {
      // over the crest: fly
      c.air = true;
      c.airT = 0;
      c.vy = Math.min(9, c.rise * 0.9);
      c.y = Math.max(c.y, g);
      out.push({ kind: "launch", id: c.id });
    } else {
      c.y = g;
    }
    c.rise = rise;
  }
  collide(d, c, out);
  const kmh = Math.round(speedOf(c) * 3.6);
  if (kmh > c.stats.topKmh) c.stats.topKmh = kmh;
}

/** Push a car out of buildings, the fountain and the outer wall. Sliding along a wall keeps most speed. */
function collide(d: District, c: Car, out: Sink) {
  const r = STATS[c.kind].radius;
  const hit = (nx: number, nz: number, depth: number) => {
    c.x += nx * depth;
    c.z += nz * depth;
    const vn = c.vx * nx + c.vz * nz;
    if (vn >= 0) return;
    // remove the into-wall part, bounce a little, scrub the slide
    c.vx -= vn * nx * 1.25;
    c.vz -= vn * nz * 1.25;
    c.vx *= 0.92;
    c.vz *= 0.92;
    if (-vn > CRASH_SPEED) {
      c.crashT = 0.8;
      c.drifting = false;
      c.stats.crashes++;
      out.push({ kind: "crash", id: c.id, speed: -vn });
    } else if (-vn > 3) out.push({ kind: "scrape", id: c.id });
  };
  // buildings are tall: in the air you still hit them (no flying over a block)
  for (const b of d.boxes) {
    if (c.x < b.x0 - r || c.x > b.x1 + r || c.z < b.z0 - r || c.z > b.z1 + r) continue;
    const px = Math.max(b.x0, Math.min(b.x1, c.x)), pz = Math.max(b.z0, Math.min(b.z1, c.z));
    let dx = c.x - px, dz = c.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist >= r) continue;
    if (dist < 1e-6) {
      // the centre is inside: leave by the nearest face
      const faces = [c.x - b.x0, b.x1 - c.x, c.z - b.z0, b.z1 - c.z];
      const k = faces.indexOf(Math.min(...faces));
      dx = k === 0 ? -1 : k === 1 ? 1 : 0;
      dz = k === 2 ? -1 : k === 3 ? 1 : 0;
      hit(dx, dz, faces[k]! + r);
      continue;
    }
    hit(dx / dist, dz / dist, r - dist);
  }
  for (const o of d.discs) {
    const dx = c.x - o.x, dz = c.z - o.z, dist = Math.hypot(dx, dz);
    if (dist < o.r + r && dist > 1e-6) hit(dx / dist, dz / dist, o.r + r - dist);
  }
  if (c.x < BOUND.min + r) hit(1, 0, BOUND.min + r - c.x);
  if (c.x > BOUND.max - r) hit(-1, 0, c.x - (BOUND.max - r));
  if (c.z < BOUND.min + r) hit(0, 1, BOUND.min + r - c.z);
  if (c.z > BOUND.max - r) hit(0, -1, c.z - (BOUND.max - r));
}

/** Car-to-car contact: push apart by mass, trade the closing speed (heavier cars shove more). */
export function bump(a: Car, b: Car): number {
  if (Math.abs(a.y - b.y) > 1.6) return 0;
  const ra = STATS[a.kind].radius, rb = STATS[b.kind].radius;
  const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
  if (dist >= ra + rb || dist < 1e-6) return 0;
  const nx = dx / dist, nz = dz / dist, depth = ra + rb - dist;
  const ma = STATS[a.kind].mass, mb = STATS[b.kind].mass, sum = ma + mb;
  a.x -= nx * depth * (mb / sum);
  a.z -= nz * depth * (mb / sum);
  b.x += nx * depth * (ma / sum);
  b.z += nz * depth * (ma / sum);
  const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (closing <= 0) return 0;
  const j = (1.3 * closing) / sum;
  a.vx -= j * mb * nx;
  a.vz -= j * mb * nz;
  b.vx += j * ma * nx;
  b.vz += j * ma * nz;
  return closing;
}

/** Put a stuck car back on the street centre nearest to it, facing `yaw`, stopped. */
export function resetCar(c: Car, x: number, z: number, yaw: number) {
  c.x = x;
  c.z = z;
  c.y = 0;
  c.yaw = yaw;
  c.vx = c.vz = c.vy = 0;
  c.air = false;
  c.rise = 0;
  c.drifting = false;
  c.stuckT = 0;
  c.crashT = 0;
}
