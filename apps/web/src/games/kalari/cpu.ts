/**
 * CPU fighters: a small, readable brain that decides a few times a second (with a human-like reaction time) and
 * turns its plan into the same KalariInput a phone produces. It approaches, strikes in short chains, mixes in
 * heavies, guards (and sometimes parries) when an opponent winds up nearby, rolls out of danger, keeps away from
 * the edges, and fires its special when someone is in range.
 */
import { MOVES, character, type Fighter, type KalariInput, type Match } from "./rules";
import { nearestOpponent } from "./combat";

export type Difficulty = "easy" | "normal" | "hard";

export interface Brain {
  seed: number;
  think: number;
  plan: "approach" | "strike" | "heavy" | "guard" | "circle" | "retreat";
  strikes: number;
  guardFor: number;
  circle: number;
  difficulty: Difficulty;
}

const SKILL: Record<Difficulty, { react: number; guard: number; parry: number; aggression: number }> = {
  easy: { react: 0.42, guard: 0.25, parry: 0.05, aggression: 0.55 },
  normal: { react: 0.28, guard: 0.45, parry: 0.15, aggression: 0.72 },
  hard: { react: 0.18, guard: 0.65, parry: 0.3, aggression: 0.85 },
};

export function newBrain(seed = 7, difficulty: Difficulty = "normal"): Brain {
  return { seed: Math.max(1, seed), think: 0, plan: "approach", strikes: 0, guardFor: 0, circle: 1, difficulty };
}

function rnd(b: Brain): number {
  b.seed = (b.seed * 16807) % 2147483647;
  return (b.seed - 1) / 2147483646;
}

/** Is `o` winding up an attack that could reach `f` soon? */
function threat(f: Fighter, o: Fighter): boolean {
  if (o.state === "special") return true;
  if (o.state !== "attack" || !o.move) return false;
  const mv = MOVES[o.move];
  return o.t < mv.startup + mv.active && Math.hypot(o.x - f.x, o.z - f.z) < mv.reach + 1;
}

export function cpuInput(m: Match, f: Fighter, b: Brain, dt: number): KalariInput {
  const out: KalariInput = { x: 0, z: 0, strike: false, heavy: false, guard: false, roll: false, special: false };
  if (m.phase !== "fight" || !f.alive) return out;
  const s = SKILL[b.difficulty];
  const o = nearestOpponent(m, f);
  if (!o) return out;
  const dx = o.x - f.x, dz = o.z - f.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  b.think -= dt;
  b.guardFor = Math.max(0, b.guardFor - dt);

  if (b.think <= 0) {
    b.think = s.react * (0.7 + rnd(b) * 0.6);
    const danger = m.fighters.some((x) => x !== f && x.alive && threat(f, x));
    if (danger && rnd(b) < s.guard) {
      b.plan = "guard";
      b.guardFor = 0.35 + rnd(b) * 0.4;
      if (rnd(b) < s.parry) b.guardFor = 0.2;
      if (rnd(b) < 0.25) { out.roll = true; b.plan = "retreat"; }
    } else if (f.meter >= 100 && d < character(f.char).special.hits[0]!.radius + 1.5) {
      out.special = true;
    } else if (d < 1.7 && rnd(b) < s.aggression) {
      b.plan = rnd(b) < 0.25 ? "heavy" : "strike";
      b.strikes = 1 + Math.floor(rnd(b) * 3);
    } else if (d < 2.6 && rnd(b) < 0.3) {
      b.plan = "circle";
      b.circle = rnd(b) < 0.5 ? 1 : -1;
    } else b.plan = "approach";
  }

  let mx = 0, mz = 0;
  switch (b.plan) {
    case "guard":
      out.guard = b.guardFor > 0;
      mx = ux * 0.2; mz = uz * 0.2;
      if (b.guardFor <= 0) b.plan = "approach";
      break;
    case "strike":
      if (d < 1.9 && (f.state === "ok" || f.state === "attack") && b.strikes > 0 && rnd(b) < 0.5) {
        out.strike = true;
        b.strikes--;
      }
      if (b.strikes <= 0) b.plan = "approach";
      mx = ux; mz = uz;
      break;
    case "heavy":
      if (d < 2.1 && f.state === "ok") { out.heavy = true; b.plan = "retreat"; }
      mx = ux; mz = uz;
      break;
    case "circle":
      mx = -uz * b.circle + ux * 0.3; mz = ux * b.circle + uz * 0.3;
      break;
    case "retreat":
      mx = -ux; mz = -uz;
      break;
    default:
      mx = ux; mz = uz;
  }
  // stay away from open edges: steer back towards the middle
  const a = m.arena;
  const ex = Math.abs(f.x) / a.hx, ez = Math.abs(f.z) / a.hz;
  if (ex > 0.8 && !(f.x < 0 ? a.walls.left : a.walls.right)) mx -= Math.sign(f.x) * 1.5 * (ex - 0.6);
  if (ez > 0.75 && !(f.z < 0 ? a.walls.back : a.walls.front)) mz -= Math.sign(f.z) * 1.5 * (ez - 0.55);
  const mag = Math.hypot(mx, mz);
  if (mag > 1) { mx /= mag; mz /= mag; }
  if (d < 1.0 && b.plan !== "retreat") { mx *= 0.2; mz *= 0.2; } // don't walk into them, fight
  out.x = mx;
  out.z = mz;
  return out;
}
