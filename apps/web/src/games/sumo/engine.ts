/**
 * Motion Sumo simulation: round wrestlers in a round ring, top-down. Move, SHOVE (a dash that costs stamina and
 * has a cooldown) and BRACE (hold: heavy and hard to move, but slow). Whoever's centre leaves the ring is out;
 * the last one inside wins the round. The ring shrinks later in a round so every round ends. Best of 3.
 * Pure and deterministic (seeded); units are stage pixels and seconds, y down.
 */
import { cpuInput } from "./cpu";

export const RING_X = 640, RING_Y = 375, RING_R = 300;
export const BODY_R = 32;
const ACC = 1150;
const DAMP = 4.2;              // velocity decay per second (terminal walking speed ≈ ACC / DAMP)
const BRACE_ACC = 0.3;
const BRACE_MASS = 3;
const DASH_SPEED = 500;
const DASH_T = 0.28;
const DASH_COST = 30;
const COOLDOWN = 0.55;
const SLAM = 230;              // extra knock-back when a dash lands
const STAMINA_REGEN = 24;
const BRACE_DRAIN = 14;
const TAP_BRACE = 1.2;         // a brace from a gesture lasts this long
const RESTITUTION = 0.55;
const CPU_PACE = 0.85;      // CPU wrestlers walk a little slower than people

/** Movement (x right, y up), a shove this step, BRACE held, or a brace tap (from a gesture: braces for a moment). */
export interface SumoInput { x: number; y: number; shove: boolean; brace: boolean; braceTap?: boolean }
export const NO_INPUT: SumoInput = { x: 0, y: 0, shove: false, brace: false };

export interface Wrestler {
  id: string;
  cpu: boolean;
  slot: number;
  x: number; y: number; vx: number; vy: number;
  /** Facing (unit vector): the last direction moved, used for a shove with no direction held. */
  fx: number; fy: number;
  stamina: number;
  dashT: number;
  cooldown: number;
  braceT: number;
  bracing: boolean;
  out: boolean;
  outT: number;
  lastTouch: string | null;
  lastTouchT: number;
  wins: number;
  ringouts: number;
  shoves: number;
  hitT: number;
  ai: SumoInput;
  aiSeed: number;
  aiThink: number;
}

export type SumoEvent =
  | { kind: "round-start"; round: number }
  | { kind: "fight" }
  | { kind: "shove"; id: string; weak: boolean }
  | { kind: "slam"; by: string; on: string; braced: boolean }
  | { kind: "bump"; a: string; b: string }
  | { kind: "shrink" }
  | { kind: "ringout"; id: string; by: string | null; left: number }
  | { kind: "round-end"; round: number; winner: string }
  | { kind: "over"; winner: string };

export interface Bout {
  wrestlers: Wrestler[];
  round: number;
  /** Round wins needed for the match (2 = best of 3). */
  toWin: number;
  maxRounds: number;
  phase: "intro" | "fight" | "round-end" | "over";
  phaseT: number;
  /** Seconds of fighting in this round. */
  time: number;
  ring: number;
  shrinkAt: number;
  shrinkDur: number;
  ringMin: number;
  roundWinner: string | null;
  winner: string | null;
  seed: number;
  events: SumoEvent[];
}

export function rnd(b: Bout) {
  b.seed = (Math.imul(b.seed, 1664525) + 1013904223) >>> 0;
  return b.seed / 4294967296;
}

export function newBout(entrants: Array<{ id: string; cpu: boolean }>, o: { toWin?: number; seed?: number; shrinkAt?: number; shrinkDur?: number } = {}): Bout {
  const b: Bout = {
    wrestlers: entrants.map((e, i) => ({
      id: e.id, cpu: e.cpu, slot: i, x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0, stamina: 100, dashT: 0, cooldown: 0, braceT: 0,
      bracing: false, out: false, outT: 0, lastTouch: null, lastTouchT: 0, wins: 0, ringouts: 0, shoves: 0, hitT: 0,
      ai: { ...NO_INPUT }, aiSeed: ((o.seed ?? 1) * 31 + i * 7717 + 3) >>> 0, aiThink: 0,
    })),
    round: 0, toWin: o.toWin ?? 2, maxRounds: (o.toWin ?? 2) * 2 + 1, phase: "intro", phaseT: 0, time: 0, ring: RING_R,
    shrinkAt: o.shrinkAt ?? 12, shrinkDur: o.shrinkDur ?? 22, ringMin: 120, roundWinner: null, winner: null,
    seed: (o.seed ?? 1) >>> 0, events: [],
  };
  startRound(b);
  b.events.length = 0;
  return b;
}

function startRound(b: Bout) {
  b.round++;
  b.phase = "intro";
  b.phaseT = 1.6;
  b.time = 0;
  b.ring = RING_R;
  b.roundWinner = null;
  const n = b.wrestlers.length;
  const turn = (b.round - 1) * 0.6; // everyone starts somewhere new each round
  b.wrestlers.forEach((w, i) => {
    const a = turn + (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = n <= 2 ? RING_R * 0.45 : RING_R * 0.6;
    Object.assign(w, {
      x: RING_X + Math.cos(a) * r, y: RING_Y + Math.sin(a) * r, vx: 0, vy: 0, fx: -Math.cos(a), fy: -Math.sin(a), stamina: 100,
      dashT: 0, cooldown: 0.4, braceT: 0, bracing: false, out: false, outT: 0, lastTouch: null, hitT: 0,
    });
  });
  b.events.push({ kind: "round-start", round: b.round });
}

/** Ring radius at a time into the round: full size, then shrinking, then slowly to nothing (sudden death). */
export function ringAt(b: Bout, t: number) {
  if (t < b.shrinkAt) return RING_R;
  const k = (t - b.shrinkAt) / b.shrinkDur;
  if (k < 1) return RING_R + (b.ringMin - RING_R) * k;
  return Math.max(BODY_R, b.ringMin - (t - b.shrinkAt - b.shrinkDur) * 6);
}

export const massOf = (w: Wrestler) => (w.bracing ? BRACE_MASS : 1) * (w.dashT > 0 ? 1.3 : 1);
const inside = (b: Bout) => b.wrestlers.filter((w) => !w.out);

function move(b: Bout, w: Wrestler, inp: SumoInput, dt: number) {
  w.braceT = inp.braceTap ? TAP_BRACE : Math.max(0, w.braceT - dt);
  w.cooldown = Math.max(0, w.cooldown - dt);
  w.dashT = Math.max(0, w.dashT - dt);
  w.hitT = Math.max(0, w.hitT - dt);
  w.bracing = (inp.brace || w.braceT > 0) && w.stamina > 2 && w.dashT <= 0;
  let mx = Math.max(-1, Math.min(1, inp.x)), my = -Math.max(-1, Math.min(1, inp.y)); // input y is up; the stage's y is down
  const m = Math.hypot(mx, my);
  if (m > 1) { mx /= m; my /= m; }
  if (m > 0.2) { w.fx = mx / Math.max(m, 1e-6); w.fy = my / Math.max(m, 1e-6); }
  if (inp.shove && w.cooldown <= 0 && !w.bracing) {
    const weak = w.stamina < DASH_COST;
    const dx = w.fx, dy = w.fy;
    const p = weak ? 0.55 : 1;
    w.vx += dx * DASH_SPEED * p;
    w.vy += dy * DASH_SPEED * p;
    w.dashT = DASH_T * p;
    w.stamina = Math.max(0, w.stamina - DASH_COST);
    w.cooldown = COOLDOWN;
    w.shoves++;
    b.events.push({ kind: "shove", id: w.id, weak });
  }
  const acc = ACC * (w.bracing ? BRACE_ACC : 1) * (w.cpu ? CPU_PACE : 1);
  w.vx += mx * acc * dt;
  w.vy += my * acc * dt;
  const damp = Math.exp(-(w.bracing ? DAMP * 2 : DAMP) * dt);
  w.vx *= damp;
  w.vy *= damp;
  w.x += w.vx * dt;
  w.y += w.vy * dt;
  w.stamina = Math.min(100, Math.max(0, w.stamina + (w.bracing ? -BRACE_DRAIN : STAMINA_REGEN) * dt));
}

function collide(b: Bout) {
  const ws = b.wrestlers;
  for (let i = 0; i < ws.length; i++) {
    const a = ws[i]!;
    if (a.out) continue;
    for (let j = i + 1; j < ws.length; j++) {
      const c = ws[j]!;
      if (c.out) continue;
      const dx = c.x - a.x, dy = c.y - a.y;
      const dd = dx * dx + dy * dy;
      if (dd >= (2 * BODY_R) ** 2 || dd === 0) continue;
      const d = Math.sqrt(dd), nx = dx / d, ny = dy / d;
      const ma = massOf(a), mc = massOf(c);
      const overlap = 2 * BODY_R - d;
      a.x -= nx * overlap * (mc / (ma + mc));
      a.y -= ny * overlap * (mc / (ma + mc));
      c.x += nx * overlap * (ma / (ma + mc));
      c.y += ny * overlap * (ma / (ma + mc));
      const vrel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
      if (vrel >= 0) continue;
      const jn = (-(1 + RESTITUTION) * vrel) / (1 / ma + 1 / mc);
      a.vx -= (nx * jn) / ma; a.vy -= (ny * jn) / ma;
      c.vx += (nx * jn) / mc; c.vy += (ny * jn) / mc;
      a.lastTouch = c.id; c.lastTouch = a.id;
      a.lastTouchT = c.lastTouchT = b.time;
      // a dash that lands sends the other wrestler flying (much less if they brace)
      let slammed = false;
      for (const [s, o, sign] of [[a, c, 1], [c, a, -1]] as const) {
        if (s.dashT <= 0) continue;
        const k = o.bracing ? 0.25 : 1;
        o.vx += nx * SLAM * k * sign;
        o.vy += ny * SLAM * k * sign;
        o.hitT = 0.3;
        s.dashT = 0;
        slammed = true;
        b.events.push({ kind: "slam", by: s.id, on: o.id, braced: o.bracing });
      }
      if (!slammed && -vrel > 90) b.events.push({ kind: "bump", a: a.id, b: c.id });
    }
  }
}

export function step(b: Bout, dt: number, inputs: Map<string, SumoInput>): SumoEvent[] {
  b.events.length = 0;
  if (b.phase === "over") return b.events;
  if (b.phase === "intro") {
    b.phaseT -= dt;
    if (b.phaseT <= 0) {
      b.phase = "fight";
      b.events.push({ kind: "fight" });
    }
    return b.events;
  }
  if (b.phase === "round-end") {
    b.phaseT -= dt;
    for (const w of b.wrestlers) if (w.out) w.outT += dt;
    if (b.phaseT <= 0) startRound(b);
    return b.events;
  }
  b.time += dt;
  const before = b.ring;
  b.ring = ringAt(b, b.time);
  if (before === RING_R && b.ring < RING_R) b.events.push({ kind: "shrink" });
  for (const w of b.wrestlers) {
    if (w.out) {
      w.outT += dt;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.vx *= Math.exp(-2 * dt);
      w.vy *= Math.exp(-2 * dt);
      continue;
    }
    move(b, w, w.cpu ? cpuInput(b, w, dt) : inputs.get(w.id) ?? NO_INPUT, dt);
  }
  collide(b);
  // ring-outs: the centre of the body crossed the edge
  const left = inside(b);
  const goneNow: Wrestler[] = [];
  for (const w of left) {
    if (Math.hypot(w.x - RING_X, w.y - RING_Y) > b.ring) goneNow.push(w);
  }
  if (goneNow.length) {
    const remaining = left.length - goneNow.length;
    // if the last ones all fall together, the one nearest the ring keeps the round
    if (remaining === 0) {
      goneNow.sort((p, q) => Math.hypot(p.x - RING_X, p.y - RING_Y) - Math.hypot(q.x - RING_X, q.y - RING_Y));
      goneNow.shift();
    }
    for (const w of goneNow) {
      w.out = true;
      w.outT = 0;
      const by = w.lastTouch && b.time - w.lastTouchT < 3 ? w.lastTouch : null;
      const pusher = by ? b.wrestlers.find((x) => x.id === by) : undefined;
      if (pusher) pusher.ringouts++;
      b.events.push({ kind: "ringout", id: w.id, by, left: left.length - goneNow.length });
    }
  }
  const still = inside(b);
  if (still.length <= 1) {
    const win = still[0]!;
    win.wins++;
    b.roundWinner = win.id;
    b.events.push({ kind: "round-end", round: b.round, winner: win.id });
    if (win.wins >= b.toWin || b.round >= b.maxRounds) {
      b.phase = "over";
      const best = [...b.wrestlers].sort((p, q) => q.wins - p.wins || q.ringouts - p.ringouts)[0]!;
      b.winner = win.wins >= b.toWin ? win.id : best.id;
      b.events.push({ kind: "over", winner: b.winner });
    } else {
      b.phase = "round-end";
      b.phaseT = 2.8;
    }
  }
  return b.events;
}

/** Match score per wrestler for ranking: round wins first, ring-outs as the tie-break. */
export function scoreOf(w: Wrestler) {
  return w.wins * 100 + w.ringouts * 10;
}
