/**
 * KALARI CLASH combat: movement, strikes with chains, heavies, guard and parry, dodge-rolls, specials, knockback,
 * walls and ring-outs. Pure functions over the match; everything worth showing on the TV becomes an event.
 */
import {
  ACCEL, BUFFER, CREDIT_WINDOW, DOWN_TIME, FRICTION, GRAVITY, GUARD_ARC, GUARD_BREAK_STUN, GUARD_CHIP, GUARD_SPEED, LAUNCH_KB,
  MAX_HEALTH, METER_MAX, MOVES, PARRY_STUN, PARRY_WINDOW, RADIUS, RING_MARGIN, ROLL_COOLDOWN, ROLL_IFRAMES, ROLL_SPEED, ROLL_TIME,
  SECOND_WIND_AT, SOFT_LOCK, WALL_SPLAT_KB, angleDiff, character,
  type FState, type Fighter, type KalariEvent, type KalariInput, type Match, type MoveId,
} from "./rules";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function setState(f: Fighter, s: FState) {
  f.state = s;
  f.t = 0;
}

/** Fighters that can be hit right now. */
export function hittable(f: Fighter): boolean {
  if (!f.alive) return false;
  if (f.state === "fall" || f.state === "out" || f.state === "ko" || f.state === "down" || f.state === "special") return false;
  if (f.state === "roll" && f.t >= ROLL_IFRAMES[0] && f.t <= ROLL_IFRAMES[1]) return false;
  return true;
}

export function nearestOpponent(m: Match, f: Fighter): Fighter | null {
  let best: Fighter | null = null, bd = Infinity;
  for (const o of m.fighters) {
    if (o === f || !o.alive || o.state === "fall" || o.team === f.team) continue;
    const d = Math.hypot(o.x - f.x, o.z - f.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Turns towards the nearest opponent in range (soft lock), so strikes connect from a phone's buttons. */
function softLock(m: Match, f: Fighter) {
  const o = nearestOpponent(m, f);
  if (o && Math.hypot(o.x - f.x, o.z - f.z) < SOFT_LOCK) f.face = Math.atan2(o.x - f.x, o.z - f.z);
}

/** Meter for dealing or taking damage; trailing fighters charge 50 % faster (comeback). */
export function gainMeter(m: Match, f: Fighter, amount: number, ev: KalariEvent[]) {
  if (f.foe) return; // clay golems have no special
  const before = f.meter;
  f.meter = Math.min(METER_MAX, f.meter + amount * (f.underdog ? 1.5 : 1));
  if (before < METER_MAX && f.meter >= METER_MAX) ev.push({ kind: "special-ready", id: f.id });
}

/** Knockback speed for a hit: grows as the victim's health falls (Smash-style), scaled by weight and comebacks. */
export function knockback(base: number, attacker: Fighter, victim: Fighter): number {
  const hurt = 0.45 + (MAX_HEALTH - victim.health * (MAX_HEALTH / victim.maxHealth)) / 90; // fresh fighters hold their ground; hurt ones fly
  const bonus = (attacker.underdog ? 1.15 : 1) * (victim.underdog ? 0.88 : 1);
  return base * hurt * character(victim.char).weight * bonus;
}

export function startMove(m: Match, f: Fighter, move: MoveId, ev: KalariEvent[]) {
  softLock(m, f);
  f.move = move;
  f.struck = [];
  f.chainQueued = false;
  setState(f, "attack");
  ev.push({ kind: "attack", id: f.id, move });
}

function applyHit(m: Match, by: Fighter, on: Fighter, o: { move: MoveId | "special"; damage: number; kb: number; lift: number; hitstun: number; guardBreak: boolean; unblockable: boolean }, ev: KalariEvent[]) {
  const dx = on.x - by.x, dz = on.z - by.z;
  const d = Math.hypot(dx, dz);
  const nx = d > 1e-3 ? dx / d : Math.sin(by.face), nz = d > 1e-3 ? dz / d : Math.cos(by.face);
  // guard: covers attacks from the front
  const facingHit = Math.abs(angleDiff(Math.atan2(-nx, -nz), on.face)) < GUARD_ARC;
  if (on.state === "guard" && facingHit && !o.unblockable) {
    if (on.guardT <= PARRY_WINDOW && o.move !== "special") {
      on.stats.parries++;
      addStyle(m, on, 50);
      gainMeter(m, on, 18, ev);
      setState(by, "stagger");
      by.stun = PARRY_STUN;
      by.vx = -nx * 3; by.vz = -nz * 3;
      by.move = null;
      ev.push({ kind: "parry", by: on.id, on: by.id, x: (on.x + by.x) / 2, z: (on.z + by.z) / 2 });
      return;
    }
    if (o.guardBreak) {
      setState(on, "stagger");
      on.stun = GUARD_BREAK_STUN;
      on.health = Math.max(1, on.health - o.damage * 0.35);
      on.vx = nx * 4; on.vz = nz * 4;
      ev.push({ kind: "guard-break", by: by.id, on: on.id, x: on.x, z: on.z });
      return;
    }
    on.stats.blocks++;
    on.health = Math.max(1, on.health - o.damage * GUARD_CHIP);
    on.vx = nx * Math.min(4, o.kb * 0.35); on.vz = nz * Math.min(4, o.kb * 0.35);
    gainMeter(m, on, 4, ev);
    ev.push({ kind: "block", by: by.id, on: on.id, x: on.x, z: on.z });
    return;
  }
  const counter = on.state === "attack" && on.move !== null && on.t < MOVES[on.move].startup; // caught mid-windup
  const dmg = Math.round(o.damage * character(by.char).power * (counter ? 1.25 : 1) * (by.foe ? 0.6 : 1) * 10) / 10;
  const kb = knockback(o.kb, by, on) * (counter ? 1.15 : 1);
  on.health = Math.max(0, on.health - dmg);
  on.vx = nx * kb; on.vz = nz * kb;
  on.vy = Math.max(on.vy, o.lift * (kb >= LAUNCH_KB ? 1 : 0.3));
  on.lastHitBy = by.id;
  on.lastHitAt = m.time;
  on.move = null;
  on.face = Math.atan2(-nx, -nz);
  const launch = kb >= LAUNCH_KB || on.health <= 0;
  setState(on, launch ? "air" : "hit");
  on.stun = o.hitstun;
  if (launch && on.vy < 3) on.vy = 3;
  by.combo = by.comboT > 0 ? by.combo + 1 : 1;
  by.comboT = 1.2;
  by.stats.hits++;
  by.stats.damage += dmg;
  by.stats.maxCombo = Math.max(by.stats.maxCombo, by.combo);
  addStyle(m, by, (o.move === "special" ? 15 : 8) * Math.min(5, by.combo));
  addStyle(m, on, -15);
  if (o.move !== "special") gainMeter(m, by, dmg * 1.7, ev); // a special never pays for the next one
  gainMeter(m, on, dmg * 0.6, ev);
  ev.push({ kind: "hit", by: by.id, on: on.id, move: o.move, damage: dmg, kb, x: on.x, y: on.y, z: on.z, combo: by.combo, launch, counter });
  if (!on.secondWind && on.health > 0 && on.health < SECOND_WIND_AT) {
    on.secondWind = true;
    gainMeter(m, on, 35, ev);
    ev.push({ kind: "second-wind", id: on.id });
  }
}

/** Victims in a cone in front of `f` (or all round with arc ≥ π). */
function inCone(m: Match, f: Fighter, reach: number, arc: number, skip: string[]): Fighter[] {
  const out: Fighter[] = [];
  for (const o of m.fighters) {
    if (o === f || o.team === f.team || !hittable(o) || skip.includes(o.id)) continue;
    const dx = o.x - f.x, dz = o.z - f.z;
    const d = Math.hypot(dx, dz) - RADIUS * 0.6;
    if (d > reach) continue;
    if (arc < Math.PI && d > 0.45 && Math.abs(angleDiff(Math.atan2(dx, dz), f.face)) > arc) continue;
    if (Math.abs(o.y - f.y) > 1.6) continue;
    out.push(o);
  }
  return out;
}

function updateAttack(m: Match, f: Fighter, inp: KalariInput, ev: KalariEvent[]) {
  const mv = MOVES[f.move!];
  if (f.t < mv.startup) {
    f.vx = Math.sin(f.face) * mv.lunge;
    f.vz = Math.cos(f.face) * mv.lunge;
  } else {
    const k = Math.exp(-FRICTION * 2 * (1 / 60));
    f.vx *= k; f.vz *= k;
  }
  if (f.t >= mv.startup && f.t < mv.startup + mv.active) {
    for (const o of inCone(m, f, mv.reach, mv.arc, f.struck)) {
      f.struck.push(o.id);
      applyHit(m, f, o, { move: f.move!, damage: mv.damage, kb: mv.kb, lift: mv.lift, hitstun: mv.hitstun, guardBreak: mv.guardBreak, unblockable: false }, ev);
      if (f.state !== "attack") return; // parried
    }
  }
  if (inp.strike && mv.next) f.chainQueued = true;
  const end = mv.startup + mv.active;
  if (f.t >= end && f.struck.length === 0 && f.t - (1 / 60) < end) ev.push({ kind: "whiff", id: f.id, move: f.move! });
  // chain into the next strike as soon as the hit window is over (cancels the recovery)
  if (f.chainQueued && mv.next && f.t >= end) {
    startMove(m, f, mv.next, ev);
    return;
  }
  if (f.t >= end + mv.recovery) {
    f.move = null;
    setState(f, "ok");
  }
}

function updateSpecial(m: Match, f: Fighter, ev: KalariEvent[]) {
  const sp = character(f.char).special;
  const t = f.t;
  if (t >= sp.dashFrom && t <= sp.dashTo) {
    f.vx = Math.sin(f.face) * sp.dash;
    f.vz = Math.cos(f.face) * sp.dash;
  } else { f.vx *= 0.8; f.vz *= 0.8; }
  while (f.specialHit < sp.hits.length && t >= sp.hits[f.specialHit]!.at) {
    const h = sp.hits[f.specialHit]!;
    f.specialHit++;
    for (const o of inCone(m, f, h.radius, h.arc, [])) {
      applyHit(m, f, o, { move: "special", damage: h.damage, kb: h.kb, lift: h.lift, hitstun: 0.5, guardBreak: true, unblockable: true }, ev);
    }
  }
  if (t >= sp.duration) setState(f, "ok");
}

/** One fixed step for a fighter on the stage. */
export function updateFighter(m: Match, f: Fighter, inp: KalariInput, dt: number, ev: KalariEvent[]) {
  f.t += dt;
  f.rollCd = Math.max(0, f.rollCd - dt);
  f.comboT = Math.max(0, f.comboT - dt);
  if (f.comboT === 0) f.combo = 0;
  f.guardT = inp.guard ? f.guardT + dt : Infinity;
  if (inp.guard && !Number.isFinite(f.guardT)) f.guardT = 0;
  const mag = Math.hypot(inp.x, inp.z);
  const mx = mag > 1 ? inp.x / mag : inp.x, mz = mag > 1 ? inp.z / mag : inp.z;

  // buffered presses: a tap slightly early still comes out
  if (inp.strike) { f.buffer = "strike"; f.bufferT = BUFFER; }
  if (inp.heavy) { f.buffer = "heavy"; f.bufferT = BUFFER; }
  if (inp.roll) { f.buffer = "roll"; f.bufferT = BUFFER; }
  f.bufferT = Math.max(0, f.bufferT - dt);
  if (f.bufferT === 0) f.buffer = null;

  const free = f.state === "ok" || f.state === "guard";
  if (free && inp.special && f.meter >= 100 && f.y <= 0) {
    softLock(m, f);
    f.meter = 0;
    f.specialHit = 0;
    f.stats.specials++;
    f.buffer = null;
    setState(f, "special");
    m.freeze = { id: f.id, until: m.time + character(f.char).special.windup };
    ev.push({ kind: "special-start", id: f.id, name: character(f.char).special.name });
  } else if (free && f.buffer === "roll" && f.rollCd === 0) {
    const a = mag > 0.25 ? Math.atan2(mx, mz) : f.face + Math.PI;
    f.rollX = Math.sin(a); f.rollZ = Math.cos(a);
    if (mag > 0.25) f.face = a;
    f.buffer = null;
    f.stats.rolls++;
    setState(f, "roll");
    ev.push({ kind: "roll", id: f.id });
  } else if (free && (f.buffer === "strike" || f.buffer === "heavy")) {
    const move = f.buffer === "heavy" ? "heavy" : "jab";
    f.buffer = null;
    startMove(m, f, move, ev);
  } else if (f.state === "ok" && inp.guard) setState(f, "guard");
  else if (f.state === "guard" && !inp.guard) setState(f, "ok");

  switch (f.state) {
    case "attack": updateAttack(m, f, inp, ev); break;
    case "special": updateSpecial(m, f, ev); break;
    case "roll":
      f.vx = f.rollX * ROLL_SPEED; f.vz = f.rollZ * ROLL_SPEED;
      if (f.t >= ROLL_TIME) {
        f.vx *= 0.25; f.vz *= 0.25;
        f.rollCd = ROLL_COOLDOWN;
        setState(f, "ok");
      }
      break;
    case "hit": case "stagger":
      f.stun -= dt;
      if (f.stun <= 0) setState(f, "ok");
      break;
    case "down":
      if (f.t >= DOWN_TIME) setState(f, "ok");
      break;
  }

  // movement
  const grounded = f.y <= 0 && f.vy <= 0;
  if (f.state === "ok" || f.state === "guard") {
    const speed = character(f.char).speed * (f.state === "guard" ? GUARD_SPEED : 1) * (f.foe ? 0.72 : 1);
    const fast = Math.hypot(f.vx, f.vz) > speed * 1.2; // knockback slides out rather than stopping dead
    const k = fast ? 1 - Math.exp(-FRICTION * dt) : Math.min(1, ACCEL * dt);
    f.vx += (mx * speed - f.vx) * k;
    f.vz += (mz * speed - f.vz) * k;
    if (mag > 0.2 && f.state === "ok") f.face += angleDiff(Math.atan2(mx, mz), f.face) * Math.min(1, 16 * dt);
  } else if (f.state === "hit" || f.state === "stagger" || f.state === "down" || f.state === "air") {
    const k = Math.exp(-(grounded ? FRICTION : FRICTION * 0.6) * dt);
    f.vx *= k; f.vz *= k;
  }
  f.x += f.vx * dt;
  f.z += f.vz * dt;
  if (!grounded || f.vy > 0) {
    f.vy -= GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) {
      const hard = f.vy < -8;
      f.y = 0;
      f.vy = 0;
      if (f.state === "air") {
        if (f.health <= 0) knockOut(m, f, ev);
        else setState(f, "down");
      }
      ev.push({ kind: "land", id: f.id, hard });
    }
  } else if (f.state === "air") setState(f, "down");
  walls(m, f, ev);
  if (f.alive && f.health <= 0 && f.state !== "air") knockOut(m, f, ev);
}

/** Walls stop fighters (and hurt when slammed into them); open sides are a drop. */
function walls(m: Match, f: Fighter, ev: KalariEvent[]) {
  const a = m.arena;
  const hit = (speed: number) => {
    if (speed > WALL_SPLAT_KB && (f.state === "air" || f.state === "hit")) {
      f.health = Math.max(0, f.health - 4);
      f.stats.walls++;
      ev.push({ kind: "wall", id: f.id, x: f.x, z: f.z });
    }
  };
  if (a.walls.left && f.x < -a.hx) { hit(-f.vx); f.x = -a.hx; f.vx = Math.abs(f.vx) * 0.3; }
  if (a.walls.right && f.x > a.hx) { hit(f.vx); f.x = a.hx; f.vx = -Math.abs(f.vx) * 0.3; }
  if (a.walls.back && f.z < -a.hz) { hit(-f.vz); f.z = -a.hz; f.vz = Math.abs(f.vz) * 0.3; }
  if (a.walls.front && f.z > a.hz) { hit(f.vz); f.z = a.hz; f.vz = -Math.abs(f.vz) * 0.3; }
}

export function offStage(m: Match, f: Fighter): boolean {
  const a = m.arena;
  return Math.abs(f.x) > a.hx + RING_MARGIN || Math.abs(f.z) > a.hz + RING_MARGIN;
}

function credit(m: Match, f: Fighter): string | null {
  return f.lastHitBy && m.time - f.lastHitAt < CREDIT_WINDOW ? f.lastHitBy : null;
}

/** Teams that still have someone standing (every fighter is a team in versus). */
export function teamsStanding(m: Match): number {
  return new Set(m.fighters.filter((o) => o.alive).map((o) => o.team)).size;
}

function lastStanding(m: Match): boolean {
  return teamsStanding(m) <= 1;
}

/** Guardians: style points for the guardian who earned them and the team meter. */
export function addStyle(m: Match, f: Fighter | undefined, points: number) {
  if (m.mode !== "guardians" || !f || f.foe) return;
  f.stats.style = Math.max(0, f.stats.style + points);
  m.style = Math.max(0, Math.min(600, m.style + points));
}

export function knockOut(m: Match, f: Fighter, ev: KalariEvent[]) {
  if (!f.alive) return;
  f.alive = false;
  f.health = 0;
  setState(f, "ko");
  const by = credit(m, f);
  if (by) m.fighters.find((o) => o.id === by)!.stats.kos++;
  const last = lastStanding(m);
  if (last) m.lastKoAt = m.time;
  ev.push({ kind: "ko", id: f.id, by, last });
}

/** Off the edge: falls out of the arena (a ring-out, whatever the health). */
export function ringOut(m: Match, f: Fighter, ev: KalariEvent[]) {
  f.alive = false;
  setState(f, "fall");
  f.vy = Math.max(f.vy, 2);
  f.stats.falls++;
  const by = credit(m, f);
  if (by) {
    const k = m.fighters.find((o) => o.id === by)!;
    k.stats.kos++;
    k.stats.ringouts++;
    addStyle(m, k, 80);
  }
  const last = lastStanding(m);
  if (last) m.lastKoAt = m.time;
  ev.push({ kind: "ringout", id: f.id, by, last });
}

export function updateFalling(f: Fighter, dt: number) {
  f.t += dt;
  f.vy -= GRAVITY * dt;
  f.y += f.vy * dt;
  f.x += f.vx * dt * 0.5;
  f.z += f.vz * dt * 0.5;
  if (f.t > 1.4) {
    f.state = "out";
    f.vx = f.vy = f.vz = 0;
  }
}

/** Fighters push each other apart instead of overlapping (not while rolling through someone). */
export function separate(m: Match) {
  const fs = m.fighters;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i]!;
    if (!a.alive || a.state === "roll") continue;
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j]!;
      if (!b.alive || b.state === "roll") continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS * 2 || d < 1e-6) continue;
      const push = (RADIUS * 2 - d) / 2;
      a.x -= (dx / d) * push; a.z -= (dz / d) * push;
      b.x += (dx / d) * push; b.z += (dz / d) * push;
    }
  }
}

export { clamp };
