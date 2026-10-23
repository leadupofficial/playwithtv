/**
 * Sky Gyro Racer simulation. The course runs along -z; each gate sits on a gentle curve in x/y.
 * Ships fly forward on their own: players steer (x), climb/dive (y) and boost. Pure and deterministic.
 */
export const GATE_GAP = 42;
export const GATE_R = 3.6;
const TUBE_R = 11;
const BASE_SPEED = 30;
const BOOST_SPEED = 26;
const BOOST_S = 1.3;
const STEER = 15;
const CLIMB = 11;
const BUMP_S = 1;
const CATCH_UP = 0.12;          // extra speed fraction per 60 units behind the leader (max 30%)

export interface Gate { z: number; x: number; y: number }
export interface Rock { z: number; x: number; y: number; r: number }
export interface Track { gates: Gate[]; rocks: Rock[]; length: number }

export interface Ship {
  id: string;
  dist: number;           // distance flown along the course
  x: number;
  y: number;
  speed: number;
  energy: number;         // boosts available (0..3, fractional refills)
  boostT: number;
  bumpT: number;
  gatesHit: number;
  nextGate: number;
  finishedAt: number | null;
}

export interface Race { track: Track; ships: Ship[]; time: number; firstFinish: number | null; over: boolean }
export interface Controls { steer: number; climb: number; boost: boolean }
export type RaceEvent =
  | { kind: "gate"; ship: string; hit: boolean }
  | { kind: "boost"; ship: string }
  | { kind: "bump"; ship: string }
  | { kind: "finish"; ship: string; place: number }
  | { kind: "over" };

function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function makeTrack(gates: number, seed = 7): Track {
  const r = rand(seed);
  const gs: Gate[] = [];
  for (let i = 1; i <= gates; i++) {
    const z = -i * GATE_GAP;
    gs.push({ z, x: Math.sin(i * 0.55) * 6 + Math.sin(i * 1.7) * 2, y: Math.cos(i * 0.4) * 3.5 });
  }
  const rocks: Rock[] = [];
  for (let i = 1; i < gates; i++) {
    if (i % 2) continue;
    const a = gs[i - 1]!, b = gs[i]!;
    const k = 0.4 + r() * 0.2;
    rocks.push({ z: a.z + (b.z - a.z) * k, x: a.x + (b.x - a.x) * k + (r() - 0.5) * 6, y: a.y + (b.y - a.y) * k + (r() - 0.5) * 4, r: 1.2 + r() * 0.8 });
  }
  return { gates: gs, rocks, length: gates * GATE_GAP };
}

/** Where the course centre is at a given distance (interpolated between gates). */
export function centreAt(t: Track, dist: number) {
  const i = Math.max(0, Math.floor(dist / GATE_GAP));
  const a = i === 0 ? { x: 0, y: 0 } : t.gates[Math.min(i, t.gates.length) - 1]!;
  const b = t.gates[Math.min(i, t.gates.length - 1)]!;
  const k = Math.max(0, Math.min(1, (dist - i * GATE_GAP) / GATE_GAP));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

export function newRace(track: Track, ids: string[]): Race {
  return {
    track, time: 0, firstFinish: null, over: false,
    ships: ids.map((id, i) => ({ id, dist: 0, x: (i - (ids.length - 1) / 2) * 2.2, y: 0, speed: BASE_SPEED, energy: 2, boostT: 0, bumpT: 0, gatesHit: 0, nextGate: 0, finishedAt: null })),
  };
}

export function stepRace(race: Race, dt: number, controls: Map<string, Controls>, timeLimit = 180): RaceEvent[] {
  if (race.over) return [];
  const ev: RaceEvent[] = [];
  race.time += dt;
  const lead = Math.max(...race.ships.map((s) => s.dist));
  for (const s of race.ships) {
    if (s.finishedAt !== null) continue;
    const c = controls.get(s.id) ?? { steer: 0, climb: 0, boost: false };
    if (c.boost && s.energy >= 1 && s.boostT <= 0) {
      s.energy -= 1;
      s.boostT = BOOST_S;
      ev.push({ kind: "boost", ship: s.id });
    }
    s.boostT = Math.max(0, s.boostT - dt);
    s.bumpT = Math.max(0, s.bumpT - dt);
    const behind = Math.min(0.3, ((lead - s.dist) / 60) * CATCH_UP);
    const target = (BASE_SPEED * (1 + behind) + (s.boostT > 0 ? BOOST_SPEED : 0)) * (s.bumpT > 0 ? 0.45 : 1);
    s.speed += (target - s.speed) * Math.min(1, dt * 3);
    const before = s.dist;
    s.dist += s.speed * dt;
    s.x += c.steer * STEER * dt;
    s.y -= c.climb * CLIMB * dt; // tipping the top edge away dives
    // stay inside the course tube
    const cc = centreAt(race.track, s.dist);
    const dx = s.x - cc.x, dy = s.y - cc.y, d = Math.hypot(dx, dy);
    if (d > TUBE_R) {
      s.x = cc.x + (dx / d) * TUBE_R;
      s.y = cc.y + (dy / d) * TUBE_R;
    }
    // gates crossed this step
    while (s.nextGate < race.track.gates.length && s.dist >= (s.nextGate + 1) * GATE_GAP) {
      const g = race.track.gates[s.nextGate]!;
      const hit = Math.hypot(s.x - g.x, s.y - g.y) <= GATE_R;
      if (hit) {
        s.gatesHit++;
        s.energy = Math.min(3, s.energy + 0.34);
      }
      ev.push({ kind: "gate", ship: s.id, hit });
      s.nextGate++;
    }
    for (const r of race.track.rocks) {
      const rz = -r.z;
      if (before < rz && s.dist >= rz && s.bumpT <= 0 && Math.hypot(s.x - r.x, s.y - r.y) < r.r + 0.9) {
        s.bumpT = BUMP_S;
        s.boostT = 0;
        ev.push({ kind: "bump", ship: s.id });
      }
    }
    if (s.dist >= race.track.length) {
      s.finishedAt = race.time;
      race.firstFinish ??= race.time;
      ev.push({ kind: "finish", ship: s.id, place: race.ships.filter((x) => x.finishedAt !== null).length });
    }
  }
  const allDone = race.ships.every((s) => s.finishedAt !== null);
  if (allDone || race.time >= timeLimit || (race.firstFinish !== null && race.time - race.firstFinish > 20)) {
    race.over = true;
    ev.push({ kind: "over" });
  }
  return ev;
}

/** Finishers by time, then everyone else by distance. Points: gates and finishing position. */
export function standings(race: Race) {
  const sorted = [...race.ships].sort((a, b) => {
    if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
    if (a.finishedAt !== null) return -1;
    if (b.finishedAt !== null) return 1;
    return b.dist - a.dist;
  });
  return sorted.map((s, i) => ({
    playerId: s.id,
    place: i + 1,
    score: s.gatesHit * 100 + (s.finishedAt !== null ? [1000, 700, 500, 300][i] ?? 200 : 0),
  }));
}
