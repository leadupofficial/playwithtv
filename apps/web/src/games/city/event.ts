/**
 * CITY RIVALS event: the one polished mode, CHECKPOINT RUSH. Phases: garage (each player picks a vehicle) → intro
 * orbit → 3-2-1 → race through the gates in order, any route you like, for N laps → results.
 * Coins fill the boost meter and respawn; drifts, air and the meter work as in car.ts; CPUs fill the field to four.
 * Pure and deterministic for a seed: the TV feeds inputs and draws the state.
 */
import { SPACING, buildDistrict, nearestCrossing, at, type District } from "./district";
import { BOOST_COST, KINDS, STATS, addMeter, bump, drive, forwardSpeed, newCar, resetCar, speedOf, wrap, type Car, type CarEvent, type CarInput, type Kind } from "./car";
import { buildGraph, cpuDrive, newBrain, type CpuBrain, type Graph } from "./cpu";

export const DT = 1 / 60;
export const FIELD = 4;
export type Phase = "garage" | "intro" | "countdown" | "race" | "results";

export interface EventOpts {
  laps: number;
  seed: number;
  garageSeconds: number;
  introSeconds: number;
  countdownSeconds: number;
  /** After the first finisher, how long the others get (s). */
  graceSeconds: number;
  /** Hard cap on the race (s): nobody circles for ever. */
  maxSeconds: number;
  resultsSeconds: number;
}
export const FULL: EventOpts = { laps: 2, seed: 1, garageSeconds: 15, introSeconds: 4, countdownSeconds: 3, graceSeconds: 20, maxSeconds: 300, resultsSeconds: 8 };
export const QUICK: EventOpts = { laps: 1, seed: 1, garageSeconds: 4, introSeconds: 1.5, countdownSeconds: 3, graceSeconds: 12, maxSeconds: 180, resultsSeconds: 5 };

export const COIN_METER = 0.1;
export const COIN_RESPAWN = 20;
const COIN_REACH = 2.4;

export interface Entrant { id: string; cpu: boolean }

export interface Rider {
  id: string;
  cpu: boolean;
  /** Garage: highlighted vehicle and whether it is locked in. */
  pick: number;
  locked: boolean;
  car: Car;
  brain: CpuBrain | null;
  /** Index into district.gates of the gate to reach next. */
  next: number;
  lap: number;
  /** Gates cleared in total (for places). */
  cleared: number;
  finishedAt: number | null;
  lapStart: number;
  laps: number[];
}

export type EventEvent =
  | CarEvent
  | { kind: "phase"; phase: Phase }
  | { kind: "count"; n: number }
  | { kind: "go" }
  | { kind: "pick"; id: string; pick: number }
  | { kind: "lock"; id: string; vehicle: Kind }
  | { kind: "gate"; id: string; gate: number; lap: number }
  | { kind: "lap"; id: string; lap: number; ms: number; best: boolean }
  | { kind: "coin"; id: string; at: number }
  | { kind: "bump"; a: string; b: string; speed: number }
  | { kind: "finish"; id: string; place: number; ms: number };

export interface CityEvent {
  opts: EventOpts;
  district: District;
  graph: Graph;
  phase: Phase;
  /** Seconds in the current phase. */
  t: number;
  /** Race clock (s) since GO. */
  clock: number;
  riders: Rider[];
  /** Per rider (same order as riders): every player collects their own set of coins. */
  coins: Array<Array<{ on: boolean; t: number }>>;
  firstFinish: number | null;
  bestLap: { id: string; ms: number } | null;
  rnd: () => number;
  lastCount: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function newEvent(humans: string[], opts: EventOpts): CityEvent {
  const district = buildDistrict();
  const rnd = rng(opts.seed);
  const entrants: Entrant[] = humans.slice(0, FIELD).map((id) => ({ id, cpu: false }));
  for (let k = 0; entrants.length < FIELD; k++) entrants.push({ id: `cpu${k + 1}`, cpu: true });
  const riders = entrants.map((e, k): Rider => {
    const g = district.grid[k]!;
    const pick = e.cpu ? Math.floor(rnd() * KINDS.length) : 0;
    return {
      id: e.id, cpu: e.cpu, pick, locked: e.cpu, car: newCar(e.id, KINDS[pick]!, g.x, g.z, g.yaw),
      brain: e.cpu ? newBrain(0.45 + rnd() * 0.4) : null, next: 1, lap: 1, cleared: 0, finishedAt: null, lapStart: 0, laps: [],
    };
  });
  return {
    opts, district, graph: buildGraph(district), phase: "garage", t: 0, clock: 0, riders,
    coins: riders.map(() => district.coins.map(() => ({ on: true, t: 0 }))), firstFinish: null, bestLap: null, rnd, lastCount: -1,
  };
}

function setPhase(e: CityEvent, p: Phase, out: EventEvent[]) {
  e.phase = p;
  e.t = 0;
  out.push({ kind: "phase", phase: p });
}

/** Garage input: steer left/right moves the highlight (edges, not holds), boost locks it in. */
export interface GarageInput { left: boolean; right: boolean; ok: boolean }

export function garage(e: CityEvent, id: string, inp: GarageInput, out: EventEvent[]) {
  const r = e.riders.find((x) => x.id === id);
  if (!r || r.locked || e.phase !== "garage") return;
  if (inp.left || inp.right) {
    r.pick = (r.pick + (inp.right ? 1 : KINDS.length - 1)) % KINDS.length;
    out.push({ kind: "pick", id, pick: r.pick });
  }
  if (inp.ok) lock(e, r, out);
}

function lock(e: CityEvent, r: Rider, out: EventEvent[]) {
  r.locked = true;
  const g = e.district.grid[e.riders.indexOf(r)]!;
  r.car = newCar(r.id, KINDS[r.pick]!, g.x, g.z, g.yaw);
  out.push({ kind: "lock", id: r.id, vehicle: KINDS[r.pick]! });
}

/** Places: finished first (by time), then laps, gates cleared, closeness to the next gate. */
export function standings(e: CityEvent): Rider[] {
  const left = (r: Rider) => {
    const g = e.district.gates[r.next]!;
    return Math.hypot(g.x - r.car.x, g.z - r.car.z);
  };
  return [...e.riders].sort((a, b) => {
    if (a.finishedAt !== null || b.finishedAt !== null) return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
    return b.cleared - a.cleared || left(a) - left(b);
  });
}
export const placeOf = (e: CityEvent, id: string) => standings(e).findIndex((r) => r.id === id) + 1;

/** Total gates for the whole race (each lap: every gate, the last being the start / finish line). */
export const totalGates = (e: CityEvent) => e.district.gates.length * e.opts.laps;

/** Where a stuck car is put back: the nearest crossing it has not just left, facing its next gate. */
function rescue(e: CityEvent, r: Rider) {
  const [i, j] = nearestCrossing(r.car.x, r.car.z);
  const g = e.district.gates[r.next]!;
  const x = at(i), z = at(j);
  const yaw = Math.atan2(g.x - x, g.z - z);
  // snap the heading to the street it will leave by (streets are axis-aligned)
  const snapped = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  resetCar(r.car, x, z, snapped);
  r.car.meter = Math.max(r.car.meter, BOOST_COST); // a boost to get going again
}

export function step(e: CityEvent, dt: number, inputs: Map<string, CarInput>): EventEvent[] {
  const out: EventEvent[] = [];
  e.t += dt;
  const o = e.opts;
  if (e.phase === "garage") {
    if (e.riders.every((r) => r.locked) && e.t > 0.6) setPhase(e, "intro", out);
    else if (e.t >= o.garageSeconds) {
      for (const r of e.riders) if (!r.locked) lock(e, r, out);
      setPhase(e, "intro", out);
    }
    return out;
  }
  if (e.phase === "intro") {
    if (e.t >= o.introSeconds) setPhase(e, "countdown", out);
    return out;
  }
  if (e.phase === "countdown") {
    const n = Math.ceil(o.countdownSeconds - e.t);
    if (n !== e.lastCount && n > 0) {
      e.lastCount = n;
      out.push({ kind: "count", n });
    }
    if (e.t >= o.countdownSeconds) {
      setPhase(e, "race", out);
      out.push({ kind: "go" });
    }
    return out;
  }
  if (e.phase === "results") return out;

  // ---- race ----
  e.clock += dt;
  const d = e.district;
  for (const r of e.riders) {
    const c = r.car;
    if (r.finishedAt !== null) {
      // coast to a stop past the line
      drive(d, c, { steer: 0, drift: false, boost: false, brake: true }, dt, out, 0.3);
      continue;
    }
    const g = d.gates[r.next]!;
    const node = (q: { x: number; z: number }) => e.graph.crossing(Math.round(q.x / SPACING), Math.round(q.z / SPACING));
    const inp = r.brain ? cpuDrive(e.graph, r.brain, c, node(g), node(d.gates[(r.next + 1) % d.gates.length]!), e.clock) : inputs.get(r.id) ?? { steer: 0, drift: false, boost: false };
    drive(d, c, inp, dt, out, r.cpu ? 0.93 : 1);
    // stuck against something: back on the street
    if (speedOf(c) < 1.5 && !c.air) c.stuckT += dt;
    else c.stuckT = 0;
    if (c.stuckT > 2.5) {
      rescue(e, r);
      if (r.brain) r.brain.path = [];
      out.push({ kind: "reset", id: r.id });
    }
    // gates
    if (Math.hypot(g.x - c.x, g.z - c.z) < g.r && c.y < 6) {
      r.cleared++;
      const gate = r.next, wasFinishLine = gate === 0;
      r.next = (r.next + 1) % d.gates.length;
      out.push({ kind: "gate", id: r.id, gate, lap: r.lap });
      if (wasFinishLine) {
        const ms = Math.round((e.clock - r.lapStart) * 1000);
        r.laps.push(ms);
        r.lapStart = e.clock;
        const best = !e.bestLap || ms < e.bestLap.ms;
        if (best) e.bestLap = { id: r.id, ms };
        out.push({ kind: "lap", id: r.id, lap: r.lap, ms, best });
        if (r.lap >= o.laps) {
          r.finishedAt = e.clock;
          e.firstFinish ??= e.clock;
          out.push({ kind: "finish", id: r.id, place: e.riders.filter((x) => x.finishedAt !== null).length, ms: Math.round(e.clock * 1000) });
        } else r.lap++;
      }
    }
  }
  // car-to-car
  for (let a = 0; a < e.riders.length; a++) {
    for (let b = a + 1; b < e.riders.length; b++) {
      const s = bump(e.riders[a]!.car, e.riders[b]!.car);
      if (s > 4) out.push({ kind: "bump", a: e.riders[a]!.id, b: e.riders[b]!.id, speed: s });
    }
  }
  // coins (each rider their own)
  e.riders.forEach((r, ri) => {
    const c = r.car, mine = e.coins[ri]!;
    d.coins.forEach((p, k) => {
      const st = mine[k]!;
      if (!st.on) {
        st.t -= dt;
        if (st.t <= 0) st.on = true;
        return;
      }
      if (Math.abs(c.x - p.x) > COIN_REACH || Math.abs(c.z - p.z) > COIN_REACH) return;
      if (Math.hypot(c.x - p.x, c.y + 0.7 - p.y, c.z - p.z) > COIN_REACH) return;
      st.on = false;
      st.t = COIN_RESPAWN;
      addMeter(c, COIN_METER);
      c.stats.coins++;
      out.push({ kind: "coin", id: r.id, at: k });
    });
  });
  const humans = e.riders.filter((r) => !r.cpu);
  const humansDone = humans.length > 0 && humans.every((r) => r.finishedAt !== null);
  if (e.riders.every((r) => r.finishedAt !== null) || humansDone
    || (e.firstFinish !== null && e.clock - e.firstFinish >= o.graceSeconds) || e.clock >= o.maxSeconds) setPhase(e, "results", out);
  return out;
}

/** Final order (ids) and race time. */
export function results(e: CityEvent): { order: string[]; ms: number } {
  return { order: standings(e).map((r) => r.id), ms: Math.round(e.clock * 1000) };
}

/** For the HUD: heading from the car to its next gate, relative to the car's yaw (0 = straight ahead, + = left). */
export function gateBearing(e: CityEvent, r: Rider): number {
  const g = e.district.gates[r.next]!;
  return wrap(Math.atan2(g.x - r.car.x, g.z - r.car.z) - r.car.yaw);
}

export { STATS, KINDS, forwardSpeed };
