import type { LevelDef } from "./levels";

/** Ball-on-a-tilting-board physics in grid units (1 cell = 1 unit; x right, y down the screen). */
export const BALL_R = 0.3;
export const MAX_TILT = 0.2;          // radians at full phone tilt
const GRAVITY = 30;                   // tuned for feel, units/s²
const ROLL_FRICTION = 1.1;            // per second
const MAX_SPEED = 9;
const BOUNCE = 0.35;
const FALL_PENALTY = 3;               // seconds
const MOVER_AMPLITUDE = 1.5;          // cells
const MOVER_PERIOD = 3.2;             // seconds

export type Cell = "#" | "." | "S" | "G" | "O" | "C" | "*" | "M" | "V";
export interface Mover { cx: number; cy: number; axis: "x" | "y"; phase: number }

export interface Level {
  def: LevelDef;
  w: number;
  h: number;
  cells: Cell[][];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  movers: Mover[];
}

export interface Ball { x: number; y: number; vx: number; vy: number }

export interface MazeState {
  level: Level;
  ball: Ball;
  checkpoint: { x: number; y: number };
  coins: Set<string>;     // collected "x,y"
  falls: number;
  time: number;           // seconds on this level, including fall penalties
  done: boolean;
  t: number;              // simulation clock for movers
}

export type MazeEvent = { kind: "fell" } | { kind: "checkpoint" } | { kind: "coin" } | { kind: "goal" } | { kind: "bump"; speed: number } | { kind: "timeout" };

const centre = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });

export function parseLevel(def: LevelDef): Level {
  const cells = def.rows.map((r) => [...r] as Cell[]);
  let start = { x: 1.5, y: 1.5 };
  let goal = { x: 1.5, y: 1.5 };
  const movers: Mover[] = [];
  cells.forEach((row, y) => row.forEach((c, x) => {
    if (c === "S") start = centre(x, y);
    if (c === "G") goal = centre(x, y);
    if (c === "M" || c === "V") movers.push({ cx: x + 0.5, cy: y + 0.5, axis: c === "M" ? "x" : "y", phase: (x + y) * 0.7 });
  }));
  return { def, w: cells[0]!.length, h: cells.length, cells, start, goal, movers };
}

export function newMaze(level: Level): MazeState {
  return { level, ball: { ...level.start, vx: 0, vy: 0 }, checkpoint: { ...level.start }, coins: new Set(), falls: 0, time: 0, done: false, t: 0 };
}

/** Centre of a moving wall at time t. */
export function moverPos(m: Mover, t: number) {
  const o = Math.sin((t / MOVER_PERIOD) * Math.PI * 2 + m.phase) * MOVER_AMPLITUDE;
  return m.axis === "x" ? { x: m.cx + o, y: m.cy } : { x: m.cx, y: m.cy + o };
}

const cellAt = (l: Level, x: number, y: number): Cell => l.cells[Math.floor(y)]?.[Math.floor(x)] ?? "#";

/** Pushes the ball out of an axis-aligned box (centre bx,by, half size hw,hh) and bounces it. */
function collideBox(b: Ball, bx: number, by: number, hw: number, hh: number): number {
  const px = Math.max(bx - hw, Math.min(b.x, bx + hw));
  const py = Math.max(by - hh, Math.min(b.y, by + hh));
  const dx = b.x - px, dy = b.y - py;
  const d = Math.hypot(dx, dy);
  if (d >= BALL_R) return 0;
  const nx = d > 1e-6 ? dx / d : b.x < bx ? -1 : 1;
  const ny = d > 1e-6 ? dy / d : 0;
  b.x += nx * (BALL_R - d);
  b.y += ny * (BALL_R - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + BOUNCE) * vn * nx;
    b.vy -= (1 + BOUNCE) * vn * ny;
    return -vn;
  }
  return 0;
}

/**
 * Advances the simulation. tiltX/tiltY in [-1, 1]: +x rolls the ball right, +y rolls it down the screen.
 * Sub-steps keep a fast ball from passing through walls.
 */
export function stepMaze(s: MazeState, dt: number, tiltX: number, tiltY: number): MazeEvent[] {
  if (s.done) return [];
  const ev: MazeEvent[] = [];
  const l = s.level;
  s.time += dt;
  s.t += dt;
  if (s.time >= l.def.timeLimit) {
    s.done = true;
    return [{ kind: "timeout" }];
  }
  const ax = Math.sin(tiltX * MAX_TILT) * GRAVITY;
  const ay = Math.sin(tiltY * MAX_TILT) * GRAVITY;
  const steps = Math.max(1, Math.ceil((Math.hypot(s.ball.vx, s.ball.vy) * dt) / 0.15));
  const h = dt / steps;
  const b = s.ball;
  let hardest = 0;
  for (let i = 0; i < steps; i++) {
    b.vx = (b.vx + ax * h) * (1 - ROLL_FRICTION * h);
    b.vy = (b.vy + ay * h) * (1 - ROLL_FRICTION * h);
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > MAX_SPEED) {
      b.vx *= MAX_SPEED / sp;
      b.vy *= MAX_SPEED / sp;
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
    for (let y = Math.floor(b.y) - 1; y <= Math.floor(b.y) + 1; y++) {
      for (let x = Math.floor(b.x) - 1; x <= Math.floor(b.x) + 1; x++) {
        if (cellAt(l, x + 0.5, y + 0.5) === "#") hardest = Math.max(hardest, collideBox(b, x + 0.5, y + 0.5, 0.5, 0.5));
      }
    }
    for (const m of l.movers) {
      const p = moverPos(m, s.t);
      hardest = Math.max(hardest, collideBox(b, p.x, p.y, 0.5, 0.5));
    }
  }
  if (hardest > 3) ev.push({ kind: "bump", speed: hardest });

  const cx = Math.floor(b.x), cy = Math.floor(b.y);
  const here = cellAt(l, b.x, b.y);
  const c = centre(cx, cy);
  const dCentre = Math.hypot(b.x - c.x, b.y - c.y);
  if (here === "O" && dCentre < 0.38) {
    s.falls++;
    s.time += FALL_PENALTY;
    Object.assign(b, { ...s.checkpoint, vx: 0, vy: 0 });
    ev.push({ kind: "fell" });
  } else if (here === "C" && (s.checkpoint.x !== c.x || s.checkpoint.y !== c.y)) {
    s.checkpoint = c;
    ev.push({ kind: "checkpoint" });
  } else if (here === "*" && !s.coins.has(`${cx},${cy}`) && dCentre < 0.5) {
    s.coins.add(`${cx},${cy}`);
    ev.push({ kind: "coin" });
  } else if (here === "G" && dCentre < 0.45) {
    s.done = true;
    ev.push({ kind: "goal" });
  }
  return ev;
}

/** Points for a finished level: speed bonus, coins, and nothing for a timeout. */
export function levelPoints(s: MazeState, reachedGoal: boolean): number {
  if (!reachedGoal) return s.coins.size * 100;
  const bonus = Math.max(0, Math.round((1 - s.time / s.level.def.timeLimit) * 1000));
  return 500 + bonus + s.coins.size * 100;
}

/** Is there a route from S to G that avoids walls and holes? (Moving walls count as open; they move.) */
export function solvable(l: Level): boolean {
  const seen = new Set<string>();
  const q = [[Math.floor(l.start.x), Math.floor(l.start.y)]];
  while (q.length) {
    const [x, y] = q.shift()!;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = l.cells[y!]?.[x!];
    if (c === "G") return true;
    if (!c || c === "#" || c === "O") continue;
    q.push([x! + 1, y!], [x! - 1, y!], [x!, y! + 1], [x!, y! - 1]);
  }
  return false;
}
