/**
 * Air hockey rules and physics, pure (no DOM). Table units: x runs -1 (left goal) … 1 (right goal), y runs
 * -HALF_W (bottom) … HALF_W (top). Side 0 defends the left goal, side 1 the right. Strikers stay in their
 * own half; the puck bounces off the rails and posts and slows a little on the air cushion.
 */

export const HALF_W = 0.55;
export const PUCK_R = 0.045;
export const STRIKER_R = 0.075;
export const GOAL_HALF = 0.17;
export const MAX_PUCK = 2.9;           // table units per second
export const HUMAN_SPEED = 4.5;        // fastest a striker can follow a finger or tilt
export const STICK_SPEED = 1.9;        // joystick top speed
const RAIL_E = 0.88;
const HIT_E = 0.92;
const AIR_DRAG = 0.22;                 // per second (exponential)
const SUBSTEPS = 6;
const SMASH_TIME = 0.2, SMASH_SPEED = 3.6, SMASH_COOLDOWN = 0.9;
const GOAL_PAUSE = 1.5;
export const SIDE_LIMIT = 7;

export interface Body { x: number; y: number; vx: number; vy: number }
export interface Striker extends Body { side: 0 | 1; smashT: number; cooldown: number; hits: number }

/** What a player (or the CPU) wants this step. */
export interface Command {
  /** "target": go to (x, y) as fast as `speed` allows (touchpad, tilt, CPU). "velocity": joystick in [-1, 1]. */
  kind: "target" | "velocity";
  x: number;
  y: number;
  speed?: number;
  smash?: boolean;
}

export type HockeyEvent =
  | { kind: "hit"; side: 0 | 1; speed: number }
  | { kind: "rail"; speed: number }
  | { kind: "goal"; scorer: 0 | 1; score: [number, number] }
  | { kind: "smash"; side: 0 | 1 }
  | { kind: "faceoff" }
  | { kind: "timeout"; side: 0 | 1 }
  | { kind: "win"; winner: 0 | 1 };

export interface Table {
  puck: Body;
  strikers: [Striker, Striker];
  score: [number, number];
  target: number;
  phase: "play" | "goal" | "over";
  phaseT: number;
  /** Side that serves after a goal (the one that conceded). */
  serve: 0 | 1;
  winner: 0 | 1 | null;
  stillT: number;
  /** Seconds the puck has been on one side (the 7-second rule). */
  sideT: number;
  lastSide: 0 | 1;
  time: number;
  seed: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function home(side: 0 | 1) {
  return { x: side === 0 ? -0.78 : 0.78, y: 0 };
}

/** The striker's allowed box: its own half, inside the rails. */
export function bounds(side: 0 | 1) {
  return side === 0
    ? { x0: -1 + STRIKER_R, x1: -STRIKER_R, y0: -HALF_W + STRIKER_R, y1: HALF_W - STRIKER_R }
    : { x0: STRIKER_R, x1: 1 - STRIKER_R, y0: -HALF_W + STRIKER_R, y1: HALF_W - STRIKER_R };
}

export function newTable(target = 7, seed = 1): Table {
  const s = (side: 0 | 1): Striker => ({ ...home(side), vx: 0, vy: 0, side, smashT: 0, cooldown: 0, hits: 0 });
  const t: Table = {
    puck: { x: 0, y: 0, vx: 0, vy: 0 }, strikers: [s(0), s(1)], score: [0, 0], target, phase: "play", phaseT: 0,
    serve: 0, winner: null, stillT: 0, sideT: 0, lastSide: 0, time: 0, seed: (Math.abs(Math.floor(seed)) % 2147483646) + 1,
  };
  faceoff(t, null);
  return t;
}

export function rand(t: Table) {
  t.seed = (t.seed * 16807) % 2147483647;
  return t.seed / 2147483647;
}

/** Puts the puck down: in the conceding side's half after a goal, or on the centre spot with a gentle drift. */
function faceoff(t: Table, side: 0 | 1 | null) {
  const p = t.puck;
  if (side === null) {
    p.x = 0; p.y = 0;
    const a = (rand(t) - 0.5) * 1.2 + (rand(t) < 0.5 ? 0 : Math.PI);
    p.vx = Math.cos(a) * 0.25; p.vy = Math.sin(a) * 0.25;
  } else {
    p.x = side === 0 ? -0.4 : 0.4; p.y = (rand(t) - 0.5) * 0.3; p.vx = 0; p.vy = 0;
  }
  t.stillT = 0;
  t.sideT = 0;
}

function moveStriker(s: Striker, cmd: Command | null, puck: Body, dt: number) {
  const b = bounds(s.side);
  const px = s.x, py = s.y;
  s.cooldown = Math.max(0, s.cooldown - dt);
  if (s.smashT > 0) {
    // lunge at the puck
    s.smashT -= dt;
    const dx = puck.x - s.x, dy = puck.y - s.y, d = Math.hypot(dx, dy) || 1;
    s.x += (dx / d) * SMASH_SPEED * dt;
    s.y += (dy / d) * SMASH_SPEED * dt;
  } else if (cmd?.kind === "target") {
    const tx = clamp(cmd.x, b.x0, b.x1), ty = clamp(cmd.y, b.y0, b.y1);
    const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
    const max = (cmd.speed ?? HUMAN_SPEED) * dt;
    if (d <= max) { s.x = tx; s.y = ty; } else { s.x += (dx / d) * max; s.y += (dy / d) * max; }
  } else if (cmd?.kind === "velocity") {
    const k = Math.min(1, dt * 14);
    const wantX = clamp(cmd.x, -1, 1) * (cmd.speed ?? STICK_SPEED), wantY = clamp(cmd.y, -1, 1) * (cmd.speed ?? STICK_SPEED);
    s.vx += (wantX - s.vx) * k;
    s.vy += (wantY - s.vy) * k;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  s.x = clamp(s.x, b.x0, b.x1);
  s.y = clamp(s.y, b.y0, b.y1);
  if (cmd?.kind !== "velocity" || s.smashT > 0) { s.vx = (s.x - px) / dt; s.vy = (s.y - py) / dt; }
  else { if (s.x === b.x0 || s.x === b.x1) s.vx = 0; if (s.y === b.y0 || s.y === b.y1) s.vy = 0; }
}

function hit(p: Body, s: Striker): number {
  const dx = p.x - s.x, dy = p.y - s.y;
  const rr = PUCK_R + STRIKER_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = dx / d, ny = dy / d;
  p.x = s.x + nx * rr;
  p.y = s.y + ny * rr;
  const rel = (p.vx - s.vx) * nx + (p.vy - s.vy) * ny;
  if (rel >= 0) return 0;
  p.vx -= (1 + HIT_E) * rel * nx;
  p.vy -= (1 + HIT_E) * rel * ny;
  return -rel;
}

/** Bounces the puck off the rails and goal posts. Returns the impact speed (0 if none). */
function rails(p: Body): number {
  let imp = 0;
  if (p.y > HALF_W - PUCK_R && p.vy > 0) { imp = Math.max(imp, p.vy); p.y = HALF_W - PUCK_R; p.vy = -p.vy * RAIL_E; }
  if (p.y < -HALF_W + PUCK_R && p.vy < 0) { imp = Math.max(imp, -p.vy); p.y = -HALF_W + PUCK_R; p.vy = -p.vy * RAIL_E; }
  const inMouth = Math.abs(p.y) < GOAL_HALF;
  if (!inMouth) {
    if (p.x > 1 - PUCK_R && p.vx > 0) { imp = Math.max(imp, p.vx); p.x = 1 - PUCK_R; p.vx = -p.vx * RAIL_E; }
    if (p.x < -1 + PUCK_R && p.vx < 0) { imp = Math.max(imp, -p.vx); p.x = -1 + PUCK_R; p.vx = -p.vx * RAIL_E; }
  }
  // posts: the corners of the goal mouths
  for (const cx of [-1, 1]) for (const cy of [-GOAL_HALF, GOAL_HALF]) {
    const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
    if (d < PUCK_R && d > 0) {
      const nx = dx / d, ny = dy / d, rel = p.vx * nx + p.vy * ny;
      p.x = cx + nx * PUCK_R; p.y = cy + ny * PUCK_R;
      if (rel < 0) { p.vx -= (1 + RAIL_E) * rel * nx; p.vy -= (1 + RAIL_E) * rel * ny; imp = Math.max(imp, -rel); }
    }
  }
  return imp;
}

/** One fixed step (1/60 s). Commands are per side; null = hold still. */
export function step(t: Table, dt: number, cmds: [Command | null, Command | null]): HockeyEvent[] {
  const ev: HockeyEvent[] = [];
  t.time += dt;
  if (t.phase === "over") return ev;
  if (t.phase === "goal") {
    t.phaseT += dt;
    for (const s of t.strikers) moveStriker(s, cmds[s.side], t.puck, dt);
    if (t.phaseT > GOAL_PAUSE) { t.phase = "play"; t.phaseT = 0; faceoff(t, t.serve); ev.push({ kind: "faceoff" }); }
    return ev;
  }
  for (const s of t.strikers) {
    const c = cmds[s.side];
    if (c?.smash && s.cooldown <= 0 && s.smashT <= 0) {
      s.smashT = SMASH_TIME;
      s.cooldown = SMASH_COOLDOWN;
      ev.push({ kind: "smash", side: s.side });
    }
  }
  const h = dt / SUBSTEPS;
  const p = t.puck;
  let railHit = 0;
  for (let i = 0; i < SUBSTEPS; i++) {
    for (const s of t.strikers) moveStriker(s, cmds[s.side], p, h);
    const drag = Math.exp(-AIR_DRAG * h);
    p.vx *= drag; p.vy *= drag;
    p.x += p.vx * h;
    p.y += p.vy * h;
    for (const s of t.strikers) {
      const r = hit(p, s);
      if (r > 0.05) { s.hits++; ev.push({ kind: "hit", side: s.side, speed: r }); if (s.smashT > 0) s.smashT = 0; }
    }
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > MAX_PUCK) { p.vx *= MAX_PUCK / sp; p.vy *= MAX_PUCK / sp; }
    railHit = Math.max(railHit, rails(p));
    // goals: the puck is fully past the goal line inside the mouth
    if (Math.abs(p.y) < GOAL_HALF && Math.abs(p.x) > 1 + PUCK_R) {
      const scorer: 0 | 1 = p.x > 0 ? 0 : 1;
      t.score[scorer]++;
      ev.push({ kind: "goal", scorer, score: [t.score[0], t.score[1]] });
      t.serve = scorer === 0 ? 1 : 0;
      p.vx = p.vy = 0;
      p.x = Math.sign(p.x) * (1 + PUCK_R * 2);
      if (t.score[scorer] >= t.target) {
        t.phase = "over";
        t.winner = scorer;
        ev.push({ kind: "win", winner: scorer });
      } else {
        t.phase = "goal";
        t.phaseT = 0;
      }
      return ev;
    }
  }
  if (railHit > 0.2) ev.push({ kind: "rail", speed: railHit });
  // a puck nobody can reach (or that has stopped dead) goes back to the centre spot
  t.stillT = Math.hypot(p.vx, p.vy) < 0.04 && Math.abs(p.x) < STRIKER_R + PUCK_R ? t.stillT + dt : 0;
  if (t.stillT > 3) { faceoff(t, null); ev.push({ kind: "faceoff" }); }
  // the 7-second rule: keep the puck on your side too long and the other player gets it
  const side: 0 | 1 = p.x < 0 ? 0 : 1;
  t.sideT = side === t.lastSide ? t.sideT + dt : 0;
  t.lastSide = side;
  if (t.sideT > SIDE_LIMIT) { faceoff(t, side === 0 ? 1 : 0); ev.push({ kind: "timeout", side }); }
  return ev;
}

/** Where the puck will cross the line x = lineX, with rail bounces, or null if it is not heading there. */
export function predictY(p: Body, lineX: number): number | null {
  if (Math.abs(p.vx) < 0.05 || Math.sign(lineX - p.x) !== Math.sign(p.vx)) return null;
  const t = (lineX - p.x) / p.vx;
  const span = 2 * (HALF_W - PUCK_R);
  let y = p.y + p.vy * t + (HALF_W - PUCK_R);
  y = ((y % (2 * span)) + 2 * span) % (2 * span);
  if (y > span) y = 2 * span - y;
  return y - (HALF_W - PUCK_R);
}
