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
  /** A computer rival: how well it hits gates (0..1). Absent for players. */
  cpu?: { skill: number; name: string };
}

/**
 * Rivals for short-handed races, so one player still has someone to beat: they steer for each gate (missing some,
 * by skill) and are held near the leading player, close enough to pass or be passed on the last gates.
 */
export const RIVALS = [
  { name: "Captain Kite", skill: 0.85, color: "#38bdf8" },
  { name: "Rocket Rani", skill: 0.7, color: "#a3e635" },
] as const;
const RIVAL_EASE = 0.08;     // a rival far ahead of every player eases off up to 15%, so the race stays in view
const RIVAL_EASE_GAP = 90;   // ...reaching that this far ahead

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

/** Players first (their order picks the split-screen views), then `rivals` computer ships from RIVALS. */
export function newRace(track: Track, ids: string[], rivals = 0): Race {
  const all = [...ids, ...RIVALS.slice(0, rivals).map((_, i) => `cpu-${i}`)];
  return {
    track, time: 0, firstFinish: null, over: false,
    ships: all.map((id, i) => ({
      id, dist: 0, x: (i - (all.length - 1) / 2) * 2.2, y: 0, speed: BASE_SPEED, energy: 2, boostT: 0, bumpT: 0, gatesHit: 0, nextGate: 0, finishedAt: null,
      ...(i >= ids.length ? { cpu: { skill: RIVALS[i - ids.length]!.skill, name: RIVALS[i - ids.length]!.name } } : {}),
    })),
  };
}

/** Rivals join a solo race only: two or more players have each other, and a computer winner would leave them no 🥇. */
export const rivalsFor = (players: number) => (players === 1 ? RIVALS.length : 0);

/** Deterministic per ship and gate, so a race replays identically (tests, and no flicker between frames). */
function hash(a: string, b: number) {
  let h = 2166136261 ^ b;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** A rival's stick: aim at the next gate, or (on the gates it is fated to miss) beside it; boost when behind. */
export function rivalControls(race: Race, s: Ship): Controls {
  const g = race.track.gates[Math.min(s.nextGate, race.track.gates.length - 1)]!;
  const miss = hash(s.id, s.nextGate) > s.cpu!.skill;
  const side = hash(s.id, s.nextGate + 999) < 0.5 ? -1 : 1;
  const tx = g.x + (miss ? side * GATE_R * 1.8 : 0);
  const ty = g.y;
  const lead = leadPlayer(race);
  return {
    steer: Math.max(-1, Math.min(1, (tx - s.x) / 2.5)),
    climb: Math.max(-1, Math.min(1, -(ty - s.y) / 2.5)),
    // rivals play by the players' rules: energy only from gates they hit, spent as soon as a boost is ready
    boost: s.energy >= 1 && lead !== null && hash(s.id, s.nextGate + 7) < s.cpu!.skill,
  };
}

function leadPlayer(race: Race): number | null {
  let lead: number | null = null;
  for (const s of race.ships) if (!s.cpu) lead = Math.max(lead ?? -Infinity, s.dist);
  return lead;
}

export function stepRace(race: Race, dt: number, controls: Map<string, Controls>, timeLimit = 180): RaceEvent[] {
  if (race.over) return [];
  const ev: RaceEvent[] = [];
  race.time += dt;
  const lead = Math.max(...race.ships.map((s) => s.dist));
  const players = race.ships.filter((s) => !s.cpu);
  for (const s of race.ships) {
    if (s.finishedAt !== null) continue;
    const c = s.cpu ? rivalControls(race, s) : controls.get(s.id) ?? { steer: 0, climb: 0, boost: false };
    if (c.boost && s.energy >= 1 && s.boostT <= 0) {
      s.energy -= 1;
      s.boostT = BOOST_S;
      ev.push({ kind: "boost", ship: s.id });
    }
    s.boostT = Math.max(0, s.boostT - dt);
    s.bumpT = Math.max(0, s.bumpT - dt);
    let behind = Math.min(0.3, ((lead - s.dist) / 60) * CATCH_UP);
    if (s.cpu) {
      // the usual catch-up when trailing; well ahead of every player, ease off (never below the players' pace)
      const pl = leadPlayer(race);
      const ahead = pl === null ? 0 : s.dist - pl;
      if (ahead > 0) behind = -Math.min(RIVAL_EASE, (ahead / RIVAL_EASE_GAP) * RIVAL_EASE);
    }
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
      if (!s.cpu) race.firstFinish ??= race.time; // a rival home first does not start the cut-off clock
      ev.push({ kind: "finish", ship: s.id, place: race.ships.filter((x) => x.finishedAt !== null).length });
    }
  }
  const allDone = race.ships.every((s) => s.finishedAt !== null);
  const playersDone = players.length > 0 && players.every((s) => s.finishedAt !== null);
  if (allDone || playersDone || race.time >= timeLimit || (race.firstFinish !== null && race.time - race.firstFinish > 20)) {
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
    cpu: !!s.cpu,
    place: i + 1,
    score: s.gatesHit * 100 + (s.finishedAt !== null ? [1000, 700, 500, 300][i] ?? 200 : 0),
  }));
}
