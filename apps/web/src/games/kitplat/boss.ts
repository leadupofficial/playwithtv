/**
 * kitplat/boss: a boss is a pattern of simple moves played in a loop (a faster loop once it is down to half its
 * health). Moves: walk, charge (telegraphed, then a rush until a wall), hop (slams the ground), shoot (arcing
 * shots), summon (a foe), swoop (flyers dive at a hero) and rest. A move can be `vulnerable` (dizzy after a charge,
 * low after a swoop): what hurts the boss is listed in `damage` (stomps, power-up projectiles, level hazards).
 */
import { type Body, Collider, newBody } from "./collide";
import type { FoeKind } from "./foes";

export type BossMoveKind = "walk" | "charge" | "hop" | "shoot" | "summon" | "swoop" | "rest";

export interface BossMove { kind: BossMoveKind; seconds: number; speed?: number; count?: number; vulnerable?: boolean }

export interface BossDef {
  id: string;
  name: string;
  /** Atlas sprite prefix: <sprite>-idle, -move, -attack, -hurt, -dizzy. */
  sprite: string;
  hp: number;
  hw: number;
  h: number;
  flying?: boolean;
  damage: Array<"stomp" | "projectile" | "hazard">;
  pattern: BossMove[];
  /** Pattern once hp ≤ half (default: the same, 25% faster). */
  angry?: BossMove[];
  shot?: { speed: number; gravity: number; sprite: string };
  summon?: FoeKind;
}

export interface Shot { x: number; y: number; vx: number; vy: number; life: number; alive: boolean }

export interface Boss {
  def: BossDef;
  body: Body;
  hp: number;
  dir: 1 | -1;
  move: number;
  t: number;
  /** Seconds left of the hit flash (no damage meanwhile). */
  hurtT: number;
  dead: boolean;
  deadT: number;
  /** Arena x bounds; the boss wakes when a hero comes within range. */
  arena: [number, number];
  awake: boolean;
  shots: Shot[];
  /** Counters within a move (hops done, shots fired). */
  n: number;
  telegraph: boolean;
  floorY: number;
}

export type BossEvent = "slam" | "shoot" | "summon" | "charge" | "wake";

export function newBoss(def: BossDef, x: number, y: number, arena: [number, number]): Boss {
  return {
    def, body: newBody(x, y, def.hw, def.h), hp: def.hp, dir: -1, move: 0, t: 0, hurtT: 0, dead: false, deadT: 0, arena,
    awake: false, shots: Array.from({ length: 8 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, alive: false })), n: 0, telegraph: false, floorY: y,
  };
}

export function currentMove(b: Boss): BossMove {
  const list = b.hp * 2 <= b.def.hp && b.def.angry ? b.def.angry : b.def.pattern;
  return list[b.move % list.length]!;
}

const ALWAYS_OPEN = new WeakMap<BossDef, boolean>();

export function bossVulnerable(b: Boss): boolean {
  let always = ALWAYS_OPEN.get(b.def);
  if (always === undefined) { always = b.def.pattern.every((m) => !m.vulnerable); ALWAYS_OPEN.set(b.def, always); }
  return !b.dead && b.hurtT <= 0 && b.awake && (currentMove(b).vulnerable === true || always);
}

function next(b: Boss) {
  b.move++;
  b.t = 0;
  b.n = 0;
  b.telegraph = false;
}

const G = 55;

/** Advances the boss. `targetX/targetY`: the nearest hero. Calls `emit` for things the world must react to. */
export function stepBoss(b: Boss, col: Collider, dt: number, targetX: number, targetY: number, emit: (e: BossEvent) => void) {
  const body = b.body;
  for (const s of b.shots) {
    if (!s.alive) continue;
    s.vy -= (b.def.shot?.gravity ?? 0) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || col.solidAt(Math.floor(s.x), Math.floor(s.y))) s.alive = false;
  }
  if (b.dead) {
    b.deadT += dt;
    body.vx = 0;
    if (!b.def.flying) gravity(b, col, dt);
    else body.y -= dt * 2;
    return;
  }
  if (!b.awake) {
    if (!Number.isNaN(targetX) && targetX > b.arena[0] + 1.5) {
      b.awake = true;
      emit("wake");
    }
    if (!b.def.flying) gravity(b, col, dt);
    return;
  }
  b.hurtT = Math.max(0, b.hurtT - dt);
  const mv = currentMove(b);
  const speedUp = b.hp * 2 <= b.def.hp && !b.def.angry ? 1.25 : 1;
  b.t += dt * speedUp;
  const toward = Number.isNaN(targetX) ? b.dir : targetX > body.x ? 1 : -1;
  switch (mv.kind) {
    case "walk":
      b.dir = toward;
      body.vx = b.dir * (mv.speed ?? 2);
      break;
    case "rest":
      body.vx = 0;
      break;
    case "charge":
      if (b.t < 0.6) {
        b.telegraph = true;
        b.dir = toward;
        body.vx = 0;
        if (b.n === 0) { b.n = 1; emit("charge"); }
      } else {
        b.telegraph = false;
        body.vx = b.dir * (mv.speed ?? 9);
      }
      break;
    case "hop":
      if (body.grounded && b.t > 0.35) {
        if (b.n >= (mv.count ?? 3)) { next(b); return; }
        b.n++;
        b.dir = toward;
        body.vy = 15;
        body.vx = b.dir * (mv.speed ?? 4);
        body.grounded = false;
        b.t = 0;
      }
      break;
    case "shoot":
      body.vx = 0;
      b.dir = toward;
      if (b.t > 0.5 + b.n * 0.55 && b.n < (mv.count ?? 3)) {
        const s = b.shots.find((x) => !x.alive);
        if (s) {
          const sp = b.def.shot?.speed ?? 8;
          s.alive = true;
          s.life = 3;
          s.x = body.x + b.dir * body.hw;
          s.y = body.y + body.h * 0.6;
          const dx = (Number.isNaN(targetX) ? s.x + b.dir * 6 : targetX) - s.x;
          const t = Math.max(0.5, Math.abs(dx) / sp);
          s.vx = dx / t;
          s.vy = ((Number.isNaN(targetY) ? s.y : targetY + 0.6) - s.y) / t + 0.5 * (b.def.shot?.gravity ?? 0) * t;
          emit("shoot");
        }
        b.n++;
      }
      break;
    case "summon":
      body.vx = 0;
      if (b.n === 0 && b.t > 0.6) {
        b.n = 1;
        emit("summon");
      }
      break;
    case "swoop": {
      // fly high to one side, then dive through the target's x low enough to stomp, and climb back
      const f = Math.min(1, b.t / mv.seconds);
      const from = b.dir > 0 ? b.arena[0] + 2 : b.arena[1] - 2;
      const to = b.dir > 0 ? b.arena[1] - 2 : b.arena[0] + 2;
      body.x = from + (to - from) * f;
      body.y = b.floorY + 5.5 - 4.6 * Math.sin(Math.PI * f) ** 2;
      body.vx = (to - from) / mv.seconds;
      if (f >= 1) { b.dir = (b.dir * -1) as 1 | -1; next(b); }
      return;
    }
  }
  if (b.def.flying) {
    body.x += body.vx * dt;
    body.y += (b.floorY + 4 + Math.sin(b.t * 2) * 0.6 - body.y) * Math.min(1, dt * 3);
  } else {
    const hit = col.moveX(body, body.vx * dt) >= 0 || body.x < b.arena[0] + body.hw || body.x > b.arena[1] - body.hw;
    body.x = Math.max(b.arena[0] + body.hw, Math.min(b.arena[1] - body.hw, body.x));
    const wasAir = !body.grounded;
    gravity(b, col, dt);
    if (wasAir && body.grounded && mv.kind === "hop") emit("slam");
    if (hit && mv.kind === "charge" && b.t >= 0.6) { emit("slam"); next(b); return; }
    if (hit && mv.kind === "walk") b.dir = (b.dir * -1) as 1 | -1;
  }
  if (b.t >= mv.seconds && mv.kind !== "hop") next(b);
}

function gravity(b: Boss, col: Collider, dt: number) {
  const body = b.body;
  body.vy = Math.max(-20, body.vy - G * dt);
  col.moveY(body, body.vy * dt);
}

/** Lands a hit if the boss can take one. Returns true when it did. */
export function hitBoss(b: Boss, how: "stomp" | "projectile" | "hazard"): boolean {
  if (!b.def.damage.includes(how) || b.dead || b.hurtT > 0 || !b.awake) return false;
  if (how === "stomp" && !bossVulnerable(b)) return false;
  b.hp--;
  b.hurtT = 1.0;
  if (b.hp <= 0) {
    b.dead = true;
    b.deadT = 0;
  } else next(b);
  return true;
}
