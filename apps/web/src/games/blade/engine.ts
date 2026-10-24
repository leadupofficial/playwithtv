/**
 * Motion Blade Trial: the rules as a pure module (no DOM). One shared 1280x720 screen (y down). Glowing
 * targets are tossed up in arcs; each player's blade cuts the ones its path crosses fast enough.
 * A cut is geometric: the blade's segment for this step intersects the target's circle.
 */
export const W = 1280, H = 720;
export const GRAV = 900;
/** How fast (px/s) a touchpad blade must move to cut. */
export const SLICE_SPEED = 750;
/** A stroke (for combos) ends after this long without cutting speed. */
export const STROKE_GAP = 0.16;
export const BOMB_STUN = 1;
export const POINTS = { target: 10, golden: 50, bomb: -25, comboPer: 5 };

export type TargetKind = "plum" | "lemon" | "gourd" | "lantern" | "golden" | "bomb";
export const FRUITS: TargetKind[] = ["plum", "lemon", "gourd", "lantern"];
export type Mode = "buttons" | "motion" | "hybrid" | "touchpad";
export type Dir = "up" | "down" | "left" | "right" | "aim";

export interface Target { id: number; kind: TargetKind; x: number; y: number; vx: number; vy: number; r: number; rot: number; spin: number; alive: boolean }

export interface Blade {
  id: string;
  x: number; y: number;
  /** Position at the start of this step (the cut segment runs from here). */
  px: number; py: number;
  /** Last movement direction (unit), for SLASH in buttons mode. */
  dx: number; dy: number;
  speed: number;
  lifted: boolean;
  strokeN: number; strokeT: number;
  stunT: number; cooldown: number;
  score: number; cuts: number; bombs: number; bestCombo: number; golden: number;
}

/** What a phone gives this step: movement axes (x right, y up) and at most one slash. */
export interface BladeInput { mode: Mode; ok: boolean; x: number; y: number; slash: Dir | null }

export type BladeEvent =
  | { kind: "cut"; id: string; target: TargetKind; x: number; y: number; angle: number; points: number }
  | { kind: "bomb"; id: string; x: number; y: number }
  | { kind: "combo"; id: string; n: number; bonus: number; x: number; y: number }
  | { kind: "slash"; id: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: "spawn"; n: number }
  | { kind: "missed"; target: TargetKind };

export interface Round {
  targets: Target[];
  blades: Blade[];
  time: number;
  limit: number;
  over: boolean;
  spawnT: number;
  rng: number;
  nextId: number;
  thrown: number;
  /** When the last golden target was thrown (one every 7-12 s). */
  lastGolden: number;
}

/** Per mode: slash length (px), extra hit radius (px) and cooldown (s) between slashes. Touchpad cuts by dragging too. */
export const TUNING: Record<Mode, { len: number; pad: number; cool: number }> = {
  touchpad: { len: 420, pad: 4, cool: 0.7 },
  motion: { len: 400, pad: 20, cool: 0.2 },
  hybrid: { len: 340, pad: 16, cool: 0.28 },
  buttons: { len: 340, pad: 16, cool: 0.28 },
};
const CURSOR_SPEED = 1300; // buttons: joystick at full deflection, px/s

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function rand(r: Round) {
  r.rng = (r.rng + 0x6d2b79f5) | 0;
  let t = r.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Distance from point (cx, cy) to the segment a-b. */
export function segDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp(((cx - ax) * vx + (cy - ay) * vy) / len2, 0, 1) : 0;
  const px = ax + vx * t - cx, py = ay + vy * t - cy;
  return Math.sqrt(px * px + py * py);
}
export const segHitsCircle = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number) => segDist(ax, ay, bx, by, cx, cy) <= r;

export function newBlade(id: string, i: number, n: number): Blade {
  const x = (W * (i + 1)) / (n + 1);
  return { id, x, y: H * 0.55, px: x, py: H * 0.55, dx: 0, dy: -1, speed: 0, lifted: true, strokeN: 0, strokeT: 0, stunT: 0, cooldown: 0, score: 0, cuts: 0, bombs: 0, bestCombo: 0, golden: 0 };
}

export function newRound(ids: string[], seed: number, limit: number): Round {
  return { targets: [], blades: ids.map((id, i) => newBlade(id, i, ids.length)), time: 0, limit, over: false, spawnT: 0.6, rng: seed | 0, nextId: 1, thrown: 0, lastGolden: 0 };
}

// ---- spawning ------------------------------------------------------------------------------

export function spawnTarget(r: Round, kind: TargetKind, x: number): Target {
  const t: Target = {
    id: r.nextId++, kind, x, y: H + 50,
    vx: (W / 2 - x) * 0.32 + (rand(r) - 0.5) * 140,
    vy: -(900 + rand(r) * 180),
    r: kind === "bomb" ? 38 : kind === "golden" ? 40 : kind === "lantern" ? 46 : 44,
    rot: rand(r) * Math.PI * 2, spin: (rand(r) - 0.5) * 5, alive: true,
  };
  r.targets.push(t);
  r.thrown++;
  return t;
}

function spawnWave(r: Round, ev: BladeEvent[]) {
  const progress = clamp(r.time / r.limit, 0, 1);
  const frenzy = r.limit - r.time < 10 ? 1 : 0;
  const players = r.blades.length;
  const n = Math.min(6, 1 + Math.floor(rand(r) * (1.6 + players * 0.7 + progress + frenzy)));
  let bombs = 0;
  for (let i = 0; i < n; i++) {
    const roll = rand(r);
    let kind: TargetKind;
    if (i === 0 && r.time - r.lastGolden > 7 + roll * 5) { kind = "golden"; r.lastGolden = r.time; }
    else if (roll < 0.1 + 0.08 * progress && bombs < 1 + (players > 2 ? 1 : 0)) { kind = "bomb"; bombs++; }
    else kind = FRUITS[Math.floor(rand(r) * FRUITS.length)]!;
    spawnTarget(r, kind, 140 + rand(r) * (W - 280));
  }
  ev.push({ kind: "spawn", n });
  r.spawnT = (1.35 - 0.5 * progress - 0.25 * frenzy) * (0.8 + rand(r) * 0.4);
}

// ---- cutting -------------------------------------------------------------------------------

function cutAlong(r: Round, b: Blade, ax: number, ay: number, bx: number, by: number, pad: number, ev: BladeEvent[]) {
  const angle = Math.atan2(by - ay, bx - ax);
  for (const t of r.targets) {
    if (!t.alive || !segHitsCircle(ax, ay, bx, by, t.x, t.y, t.r + pad)) continue;
    t.alive = false;
    if (t.kind === "bomb") {
      b.score = Math.max(0, b.score + POINTS.bomb);
      b.bombs++;
      b.stunT = BOMB_STUN;
      b.strokeN = 0;
      ev.push({ kind: "bomb", id: b.id, x: t.x, y: t.y });
      return; // the blast stops this blade
    }
    const points = t.kind === "golden" ? POINTS.golden : POINTS.target;
    b.score += points;
    b.cuts++;
    if (t.kind === "golden") b.golden++;
    b.strokeN++;
    ev.push({ kind: "cut", id: b.id, target: t.kind, x: t.x, y: t.y, angle, points });
  }
}

function endStroke(b: Blade, ev: BladeEvent[]) {
  if (b.strokeN >= 3) {
    const bonus = b.strokeN * POINTS.comboPer;
    b.score += bonus;
    b.bestCombo = Math.max(b.bestCombo, b.strokeN);
    ev.push({ kind: "combo", id: b.id, n: b.strokeN, bonus, x: b.x, y: b.y });
  }
  b.strokeN = 0;
}

const DIRS: Record<Exclude<Dir, "aim">, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Moves the blade's cursor the way this player's mode works. Returns whether the move itself may cut. */
export function moveCursor(b: Blade, inp: BladeInput, dt: number): boolean {
  b.px = b.x;
  b.py = b.y;
  if (!inp.ok) return false;
  if (inp.mode === "touchpad") {
    // the finger's place on the pad is the blade's place on the screen; (0, 0) exactly = no finger
    if (inp.x === 0 && inp.y === 0) {
      b.lifted = true;
      return false;
    }
    const tx = ((inp.x + 1) / 2) * W, ty = ((1 - inp.y) / 2) * H;
    if (b.lifted) {
      b.lifted = false;
      b.x = b.px = tx;
      b.y = b.py = ty;
      return false; // a new touch starts here: no cut across the screen
    }
    const k = Math.min(1, dt * 30);
    b.x += (tx - b.x) * k;
    b.y += (ty - b.y) * k;
    return true;
  }
  if (inp.mode === "motion" || inp.mode === "hybrid") {
    // tilt aims: the phone's angle points at a place on the screen
    const tx = W / 2 + clamp(inp.x, -1, 1) * W * 0.47, ty = H / 2 - clamp(inp.y, -1, 1) * H * 0.47;
    const k = Math.min(1, dt * 14);
    b.x += (tx - b.x) * k;
    b.y += (ty - b.y) * k;
    return false;
  }
  b.x = clamp(b.x + clamp(inp.x, -1, 1) * CURSOR_SPEED * dt, 0, W);
  b.y = clamp(b.y - clamp(inp.y, -1, 1) * CURSOR_SPEED * dt, 0, H);
  return false;
}

function stepBlade(r: Round, b: Blade, inp: BladeInput, dt: number, ev: BladeEvent[]) {
  b.stunT = Math.max(0, b.stunT - dt);
  b.cooldown = Math.max(0, b.cooldown - dt);
  const canMoveCut = moveCursor(b, inp, dt);
  const mx = b.x - b.px, my = b.y - b.py;
  const dist = Math.sqrt(mx * mx + my * my);
  b.speed = dist / dt;
  if (dist > 2) { b.dx = mx / dist; b.dy = my / dist; }
  let cutting = false;
  if (!r.over && b.stunT <= 0) {
    if (canMoveCut && b.speed >= SLICE_SPEED) {
      cutting = true;
      cutAlong(r, b, b.px, b.py, b.x, b.y, TUNING.touchpad.pad, ev);
    }
    if (inp.slash && b.cooldown <= 0 && b.stunT <= 0) {
      const tune = TUNING[inp.mode];
      let ux: number, uy: number;
      if (inp.slash === "aim") {
        // buttons: along the stick, or the way the cursor last moved
        const sl = Math.hypot(inp.x, inp.y);
        if (sl > 0.3) { ux = inp.x / sl; uy = -inp.y / sl; } else { ux = b.dx; uy = b.dy; }
      } else [ux, uy] = DIRS[inp.slash];
      const x1 = b.x - ux * tune.len * 0.35, y1 = b.y - uy * tune.len * 0.35;
      const x2 = b.x + ux * tune.len * 0.65, y2 = b.y + uy * tune.len * 0.65;
      b.cooldown = tune.cool;
      ev.push({ kind: "slash", id: b.id, x1, y1, x2, y2 });
      cutAlong(r, b, x1, y1, x2, y2, tune.pad, ev);
      cutting = true;
      b.strokeT = STROKE_GAP - 0.05; // a slash is a stroke of its own (combos count within it)
    }
  }
  if (cutting) {
    if (!inp.slash) b.strokeT = 0;
  } else {
    b.strokeT += dt;
    if (b.strokeT >= STROKE_GAP && b.strokeN > 0) endStroke(b, ev);
  }
}

/**
 * One fixed step: targets fly, blades move and cut (in a rotating order so nobody always gets the first
 * cut), waves are thrown until the time is up. `inputs[i]` belongs to `r.blades[i]`.
 */
export function stepRound(r: Round, dt: number, inputs: BladeInput[], ev: BladeEvent[]) {
  if (!r.over) {
    r.time += dt;
    r.spawnT -= dt;
    if (r.spawnT <= 0 && r.time < r.limit - 0.8) spawnWave(r, ev);
  }
  for (const t of r.targets) {
    if (!t.alive) continue;
    t.vy += GRAV * dt;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.rot += t.spin * dt;
    if (t.vy > 0 && t.y > H + 70) {
      t.alive = false;
      ev.push({ kind: "missed", target: t.kind });
    }
  }
  const n = r.blades.length;
  const first = Math.floor(r.time * 60) % Math.max(1, n);
  for (let k = 0; k < n; k++) {
    const i = (first + k) % n;
    stepBlade(r, r.blades[i]!, inputs[i] ?? { mode: "buttons", ok: false, x: 0, y: 0, slash: null }, dt, ev);
  }
  let m = 0;
  for (const t of r.targets) if (t.alive) r.targets[m++] = t;
  r.targets.length = m;
  if (!r.over && r.time >= r.limit) {
    r.over = true;
    for (const b of r.blades) endStroke(b, ev);
  }
}

export function scores(r: Round): Map<string, number> {
  return new Map(r.blades.map((b) => [b.id, b.score]));
}
