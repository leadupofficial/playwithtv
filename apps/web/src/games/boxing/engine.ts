/**
 * Ring Kings Boxing: the fight simulation, independent of rendering and networking so it can be unit-tested.
 * Units: x in ring pixels (1280-wide stage), time in seconds.
 */

export type PunchType = "jab" | "hook" | "upper" | "super";

export interface PunchSpec {
  dur: number;          // whole animation
  activeAt: number;     // moment the punch lands (or misses)
  range: number;        // reach in px between fighters' centres
  dmg: number;
  stamina: number;
  stun: number;         // how long the victim reels
}

export const PUNCHES: Record<PunchType, PunchSpec> = {
  // a landed jab reels the victim for less than the jab's own recovery (0.12 + 0.14 < 0.3), so jabbing is not a
  // loop: the one hit is free first and can block, slip or punch back. Heavier punches still buy an opening.
  jab: { dur: 0.3, activeAt: 0.12, range: 235, dmg: 5, stamina: 6, stun: 0.14 },
  hook: { dur: 0.46, activeAt: 0.24, range: 205, dmg: 9, stamina: 11, stun: 0.34 },
  upper: { dur: 0.56, activeAt: 0.3, range: 190, dmg: 13, stamina: 15, stun: 0.5 },
  super: { dur: 0.72, activeAt: 0.38, range: 230, dmg: 22, stamina: 0, stun: 0.9 },
};

export const RING = { left: 190, right: 1090, minGap: 165, walk: 240 };
export const ROUND_SECONDS = 60;
export const ROUNDS = 3;
export const COUNT_SECONDS = 10;

export type FighterState = "idle" | "punch" | "dodge" | "hit" | "down" | "out" | "win";

export interface Controls {
  left: boolean;
  right: boolean;
  block: boolean;
  /** one-shot presses since the last step */
  jab: boolean; hook: boolean; upper: boolean; dodge: boolean; super: boolean; mash: number;
}

export const NO_CONTROLS: Controls = { left: false, right: false, block: false, jab: false, hook: false, upper: false, dodge: false, super: false, mash: 0 };

export interface Fighter {
  id: string;
  name: string;
  color: string;
  skin: string;
  cpu: boolean;
  side: -1 | 1;           // -1 starts on the left facing right, +1 on the right facing left
  x: number;
  hp: number;
  stamina: number;
  superMeter: number;     // 0..1
  state: FighterState;
  stateT: number;         // time in the current state
  punch: PunchType | null;
  punchResolved: boolean;
  blocking: boolean;
  walking: number;        // -1, 0, 1 (screen direction) for the walk animation
  dodgeCooldown: number;
  combo: number;
  comboT: number;
  knockdowns: number;
  mashNeeded: number;
  mashCount: number;
  damageDealt: number;
  landed: number;
  thrown: number;
}

export type FightEvent =
  | { kind: "hit"; by: string; on: string; punch: PunchType; dmg: number; combo: number; heavy: boolean }
  | { kind: "blocked"; by: string; on: string }
  | { kind: "slipped"; by: string; on: string }
  | { kind: "whiff"; by: string }
  | { kind: "down"; on: string; knockdowns: number }
  | { kind: "up"; on: string }
  | { kind: "ko"; winner: string; loser: string; tko: boolean }
  | { kind: "bell"; round: number }
  | { kind: "round-end"; round: number }
  | { kind: "decision"; winner: string | null };

export type Phase = "intro" | "fight" | "break" | "over";

export interface Fight {
  a: Fighter;
  b: Fighter;
  phase: Phase;
  phaseT: number;
  round: number;
  clock: number;          // seconds left in the round
  count: number;          // referee count while someone is down
  winner: string | null;  // null + phase over = draw
  shake: number;
  roundSeconds: number;
}

const SKINS = ["#8d5524", "#c68642", "#e0ac69", "#a0673f", "#5c3a21"];

export function makeFighter(id: string, name: string, color: string, side: -1 | 1, cpu: boolean, skinSeed: number): Fighter {
  return {
    id, name, color, cpu, side, skin: SKINS[Math.abs(skinSeed) % SKINS.length]!,
    x: side < 0 ? 430 : 850,
    hp: 100, stamina: 100, superMeter: 0, state: "idle", stateT: 0, punch: null, punchResolved: false,
    blocking: false, walking: 0, dodgeCooldown: 0, combo: 0, comboT: 0, knockdowns: 0, mashNeeded: 0, mashCount: 0,
    damageDealt: 0, landed: 0, thrown: 0,
  };
}

export function newFight(a: Fighter, b: Fighter, roundSeconds = ROUND_SECONDS): Fight {
  return { a, b, phase: "intro", phaseT: 0, round: 1, clock: roundSeconds, count: 0, winner: null, shake: 0, roundSeconds };
}

function other(f: Fight, x: Fighter) {
  return x === f.a ? f.b : f.a;
}

/** Facing: +1 means facing right. A fighter always faces the opponent. */
export function facing(me: Fighter, opp: Fighter): 1 | -1 {
  return opp.x >= me.x ? 1 : -1;
}

function setState(x: Fighter, s: FighterState) {
  x.state = s;
  x.stateT = 0;
}

function startPunch(x: Fighter, p: PunchType) {
  const spec = PUNCHES[p];
  if (p === "super") {
    if (x.superMeter < 1) return;
    x.superMeter = 0;
  } else if (x.stamina < spec.stamina * 0.5) {
    return; // too tired to throw it
  }
  x.stamina = Math.max(0, x.stamina - spec.stamina);
  x.punch = p;
  x.punchResolved = false;
  x.thrown++;
  setState(x, "punch");
}

/** Applies one fighter's controls (only when free to act). */
function act(f: Fight, x: Fighter, c: Controls, dt: number) {
  x.blocking = false;
  x.walking = 0;
  if (x.state === "down") {
    x.mashCount += c.mash;
    return;
  }
  if (x.state !== "idle") return;
  const opp = other(f, x);
  if (c.super && x.superMeter >= 1) return startPunch(x, "super");
  if (c.upper) return startPunch(x, "upper");
  if (c.hook) return startPunch(x, "hook");
  if (c.jab) return startPunch(x, "jab");
  if (c.dodge && x.dodgeCooldown <= 0 && x.stamina >= 5) {
    x.stamina -= 5;
    x.dodgeCooldown = 0.9;
    return setState(x, "dodge");
  }
  if (c.block) {
    x.blocking = true;
    return;
  }
  const dir = (c.right ? 1 : 0) - (c.left ? 1 : 0);
  if (dir !== 0) {
    let nx = x.x + dir * RING.walk * dt;
    nx = Math.max(RING.left, Math.min(RING.right, nx));
    if (Math.abs(nx - opp.x) < RING.minGap) nx = opp.x - Math.sign(opp.x - x.x || x.side) * RING.minGap;
    x.x = nx;
    x.walking = dir;
  }
}

function resolvePunch(f: Fight, x: Fighter, events: FightEvent[]) {
  const opp = other(f, x);
  const spec = PUNCHES[x.punch!];
  x.punchResolved = true;
  const dist = Math.abs(opp.x - x.x);
  if (dist > spec.range || opp.state === "down" || opp.state === "out") {
    x.combo = 0;
    events.push({ kind: "whiff", by: x.id });
    return;
  }
  if (opp.state === "dodge" && opp.stateT < 0.32) {
    x.combo = 0;
    opp.superMeter = Math.min(1, opp.superMeter + 0.08); // reward a good slip
    events.push({ kind: "slipped", by: x.id, on: opp.id });
    return;
  }
  const tired = x.stamina < 15 ? 0.6 : 1;
  if (opp.blocking && x.punch !== "super") {
    const chip = spec.dmg * 0.15 * tired;
    opp.hp = Math.max(1, opp.hp - chip);
    opp.stamina = Math.max(0, opp.stamina - spec.dmg * 0.6);
    x.combo = 0;
    events.push({ kind: "blocked", by: x.id, on: opp.id });
    return;
  }
  x.combo = x.comboT > 0 ? x.combo + 1 : 1;
  x.comboT = 0.7;
  const comboBonus = 1 + Math.min(0.5, (x.combo - 1) * 0.15);
  const dmg = Math.round(spec.dmg * tired * comboBonus * 10) / 10;
  opp.hp = Math.max(0, opp.hp - dmg);
  x.damageDealt += dmg;
  x.landed++;
  x.superMeter = Math.min(1, x.superMeter + dmg / 55);
  opp.punch = null;
  setState(opp, "hit");
  opp.stateT = -spec.stun + PUNCHES.jab.stun; // longer reel for heavier punches
  const heavy = x.punch === "upper" || x.punch === "super" || x.combo >= 3;
  f.shake = Math.max(f.shake, heavy ? 0.35 : 0.12);
  events.push({ kind: "hit", by: x.id, on: opp.id, punch: x.punch!, dmg, combo: x.combo, heavy });
  if (opp.hp <= 0) knockDown(f, opp, events);
}

function knockDown(f: Fight, x: Fighter, events: FightEvent[]) {
  x.knockdowns++;
  x.punch = null;
  setState(x, "down");
  f.count = 0;
  x.mashCount = 0;
  x.mashNeeded = 10 + 8 * (x.knockdowns - 1);
  events.push({ kind: "down", on: x.id, knockdowns: x.knockdowns });
  if (x.knockdowns >= 3) endByKo(f, x, true, events);
}

function endByKo(f: Fight, loser: Fighter, tko: boolean, events: FightEvent[]) {
  const win = other(f, loser);
  setState(loser, "out");
  setState(win, "win");
  f.winner = win.id;
  f.phase = "over";
  f.phaseT = 0;
  events.push({ kind: "ko", winner: win.id, loser: loser.id, tko });
}

function tickFighter(x: Fighter, dt: number) {
  x.stateT += dt;
  x.dodgeCooldown = Math.max(0, x.dodgeCooldown - dt);
  x.comboT = Math.max(0, x.comboT - dt);
  if (x.comboT === 0) x.combo = 0;
  if (x.state !== "punch") x.stamina = Math.min(100, x.stamina + (x.blocking ? 6 : 13) * dt);
  if (x.state === "punch" && x.stateT >= PUNCHES[x.punch!].dur) {
    x.punch = null;
    setState(x, "idle");
  }
  if (x.state === "dodge" && x.stateT >= 0.42) setState(x, "idle");
  if (x.state === "hit" && x.stateT >= PUNCHES.jab.stun) setState(x, "idle");
}

/** Advances the fight by dt seconds with both fighters' controls. Returns what happened. */
export function step(f: Fight, dt: number, ca: Controls, cb: Controls): FightEvent[] {
  const ev: FightEvent[] = [];
  f.phaseT += dt;
  f.shake = Math.max(0, f.shake - dt);
  if (f.phase === "intro") {
    if (f.phaseT >= 2.5) {
      f.phase = "fight";
      f.phaseT = 0;
      ev.push({ kind: "bell", round: f.round });
    }
    return ev;
  }
  if (f.phase === "over") {
    tickFighter(f.a, dt);
    tickFighter(f.b, dt);
    return ev;
  }
  if (f.phase === "break") {
    if (f.phaseT >= 4) {
      f.round++;
      f.clock = f.roundSeconds;
      for (const x of [f.a, f.b]) {
        x.hp = Math.min(100, x.hp + 15);
        x.stamina = 100;
        x.x = x.side < 0 ? 430 : 850;
        setState(x, "idle");
      }
      f.phase = "fight";
      f.phaseT = 0;
      ev.push({ kind: "bell", round: f.round });
    }
    return ev;
  }

  // fight
  const down = f.a.state === "down" ? f.a : f.b.state === "down" ? f.b : null;
  if (!down) f.clock = Math.max(0, f.clock - dt);
  act(f, f.a, ca, dt);
  act(f, f.b, cb, dt);
  for (const x of [f.a, f.b]) {
    if (x.state === "punch" && !x.punchResolved && x.stateT >= PUNCHES[x.punch!].activeAt) resolvePunch(f, x, ev);
    if (f.phase !== "fight") return ev;
  }
  tickFighter(f.a, dt);
  tickFighter(f.b, dt);

  if (down) {
    const before = Math.floor(f.count);
    f.count += dt;
    if (down.mashCount >= down.mashNeeded) {
      down.hp = Math.max(20, 45 - 10 * down.knockdowns);
      down.stamina = 60;
      setState(down, "idle");
      ev.push({ kind: "up", on: down.id });
    } else if (f.count >= COUNT_SECONDS) {
      endByKo(f, down, false, ev);
    } else if (Math.floor(f.count) !== before) {
      // the count ticks are rendered from f.count
    }
    return ev;
  }

  if (f.clock <= 0) {
    ev.push({ kind: "round-end", round: f.round });
    if (f.round >= ROUNDS) {
      const pa = f.a.damageDealt + 10 * f.b.knockdowns, pb = f.b.damageDealt + 10 * f.a.knockdowns;
      f.winner = pa === pb ? null : pa > pb ? f.a.id : f.b.id;
      f.phase = "over";
      f.phaseT = 0;
      if (f.winner) setState(f.winner === f.a.id ? f.a : f.b, "win");
      ev.push({ kind: "decision", winner: f.winner });
    } else {
      f.phase = "break";
      f.phaseT = 0;
    }
  }
  return ev;
}

// ---- CPU opponent -------------------------------------------------------------

export interface Brain {
  next: number;      // seconds until the next decision
  hold: Partial<Controls>;
  holdFor: number;
  /** seconds to the CPU's next GET UP tap while down: a human thumb, whatever the frame rate */
  mashIn: number;
}

export function newBrain(): Brain {
  return { next: 0.6, hold: {}, holdFor: 0, mashIn: 0.3 };
}

/** A simple, readable opponent: closes distance, mixes punches, sometimes blocks or slips; harder each round. */
export function cpuControls(f: Fight, me: Fighter, brain: Brain, dt: number, rand: () => number): Controls {
  const c: Controls = { ...NO_CONTROLS };
  const opp = other(f, me);
  if (me.state === "down") {
    // about 5-8 taps a second (faster in later rounds), like a determined player; once per decision, not per frame
    brain.mashIn -= dt;
    if (brain.mashIn <= 0) {
      c.mash = 1;
      brain.mashIn = (0.8 + 0.4 * rand()) / (5 + f.round);
    }
    return c;
  }
  brain.holdFor -= dt;
  if (brain.holdFor > 0) Object.assign(c, brain.hold);
  brain.next -= dt;
  if (brain.next > 0) return c;
  const aggression = 0.32 + 0.12 * f.round;
  brain.next = 0.18 + rand() * (0.5 - 0.06 * f.round);
  const dist = Math.abs(opp.x - me.x);
  const toward = opp.x > me.x ? "right" : "left";
  const away = toward === "right" ? "left" : "right";
  const threatened = opp.state === "punch" && opp.stateT < PUNCHES[opp.punch!].activeAt;
  if (threatened && dist < 245) {
    const r = rand();
    if (r < 0.28 + 0.06 * f.round) {
      brain.hold = { block: true };
      brain.holdFor = 0.45;
      return { ...c, block: true };
    }
    if (r < 0.42 + 0.06 * f.round) return { ...c, dodge: true };
  }
  if (me.superMeter >= 1 && dist < 220 && rand() < 0.6) return { ...c, super: true };
  if (dist > 215) {
    brain.hold = { [toward]: true };
    brain.holdFor = 0.25;
    return { ...c, [toward]: true };
  }
  if (me.stamina < 25 && rand() < 0.5) {
    brain.hold = { [away]: true };
    brain.holdFor = 0.35;
    return { ...c, [away]: true };
  }
  if (rand() < aggression) {
    const r = rand();
    if (r < 0.55) return { ...c, jab: true };
    if (r < 0.85) return { ...c, hook: true };
    return { ...c, upper: true };
  }
  if (rand() < 0.2) {
    brain.hold = { block: true };
    brain.holdFor = 0.3;
  }
  return c;
}
