/**
 * Skyline Stacker (single-player, falling-block puzzle). Pip, the crane operator, stacks building blocks
 * into rows; every full row is "built" and makes room for the next floor of the city.
 */
import type { Draw } from "../kitgrid/draw";
import { rng, shuffle } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";

export const W = 10;
export const H = 20;
const PANEL = 6;

type Shape = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
const SHAPES: Record<Shape, Array<[number, number]>> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const SPRITE: Record<Shape, string> = { I: "b-teal", O: "b-yellow", T: "b-purple", S: "b-green", Z: "b-red", J: "b-blue", L: "b-orange" };
const RUBBLE = "rubble";
const LINE_POINTS = [0, 100, 300, 500, 800];
const LOCK_MS = 500;

export interface StackLevel {
  name: string;
  world: number;
  /** Rows to build. */
  lines: number;
  /** Ms per row of fall at the start (gets 8% faster every 10 rows built). */
  fallMs: number;
  /** Rows of rubble at the bottom to clear (one gap each). */
  rubble: number;
  /** Second star: score at least this. */
  target: number;
  /** Third star: finish using at most this many blocks. */
  pieces: number;
}

export const WORLDS = [
  {
    name: "World 1 · Harbour Town",
    text: "A brand-new city is being built by the sea, and Pip runs the biggest crane in town. Steer each falling block, turn it to fit, and fill a whole row to build a floor. Don't let the pile reach the top of the crane!",
  },
  {
    name: "World 2 · Storm Quarter",
    text: "Last night's storm left rubble in the streets. Clear it away by building through it. Each piece of rubble has one gap: find it!",
  },
  {
    name: "World 3 · Sky District",
    text: "The tallest towers rise above the clouds. The blocks fall faster up here, so plan ahead with the next-block window. Build four rows at once for a Skyline bonus!",
  },
];

export const LEVELS: StackLevel[] = [
  { name: "Ground Floor", world: 0, lines: 5, fallMs: 800, rubble: 0, target: 600, pieces: 22 },
  { name: "Corner Shop", world: 0, lines: 8, fallMs: 700, rubble: 0, target: 1100, pieces: 32 },
  { name: "Harbour Row", world: 0, lines: 12, fallMs: 620, rubble: 0, target: 1800, pieces: 45 },
  { name: "Fallen Signs", world: 1, lines: 10, fallMs: 600, rubble: 3, target: 1700, pieces: 40 },
  { name: "Flooded Lane", world: 1, lines: 12, fallMs: 540, rubble: 5, target: 2200, pieces: 48 },
  { name: "Storm Drain", world: 1, lines: 15, fallMs: 480, rubble: 7, target: 2900, pieces: 58 },
  { name: "Cloud Line", world: 2, lines: 15, fallMs: 400, rubble: 2, target: 3200, pieces: 56 },
  { name: "Glass Tower", world: 2, lines: 18, fallMs: 330, rubble: 4, target: 4000, pieces: 68 },
  { name: "Wind Shear", world: 2, lines: 20, fallMs: 270, rubble: 6, target: 4800, pieces: 76 },
  { name: "The Spire", world: 2, lines: 25, fallMs: 220, rubble: 4, target: 6200, pieces: 92 },
];

interface Piece { shape: Shape; rot: number; x: number; y: number }

export function cells(p: Piece): Array<[number, number]> {
  const n = p.shape === "I" ? 4 : 3;
  return SHAPES[p.shape].map(([x, y]) => {
    let cx = x, cy = y;
    for (let i = 0; i < ((p.rot % 4) + 4) % 4; i++) [cx, cy] = [n - 1 - cy, cx];
    if (p.shape === "O") [cx, cy] = [x, y];
    return [p.x + cx, p.y + cy] as [number, number];
  });
}

export class StackSim implements Sim {
  readonly cols = W + PANEL;
  readonly rows = H;
  board: (string | null)[][];
  piece!: Piece;
  next: Shape[] = [];
  private bag: Shape[] = [];
  private r: () => number;
  private fall = 0;
  private lockMs = 0;
  built = 0;
  used = 0;
  score = 0;
  ms = 0;
  private done: Outcome | null = null;
  private clearing: { rows: number[]; ms: number } | null = null;
  readonly goal: number;
  private combo = 0;

  constructor(private level: StackLevel, private index: number, seed: number, quick = false) {
    this.r = rng(seed);
    this.board = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
    this.goal = quick ? 1 : level.lines;
    for (let i = 0; i < level.rubble; i++) {
      const gap = Math.floor(this.r() * W);
      this.board[H - 1 - i] = Array.from({ length: W }, (_, x) => (x === gap ? null : RUBBLE));
    }
    if (quick) {
      // tests: the first block is a flat I that finishes the bottom row
      this.board[H - 1] = Array.from({ length: W }, (_, x) => (x >= 3 && x <= 6 ? null : RUBBLE));
      this.next = ["I"];
    }
    this.fill();
    this.spawn();
  }

  private fill() {
    while (this.next.length < 4) {
      if (!this.bag.length) this.bag = shuffle(this.r, ["I", "O", "T", "S", "Z", "J", "L"]);
      this.next.push(this.bag.pop()!);
    }
  }

  get fallMs() {
    return this.level.fallMs * 0.92 ** Math.floor(this.built / 10);
  }

  private spawn(): SimEvent[] {
    const shape = this.next.shift()!;
    this.fill();
    this.piece = { shape, rot: 0, x: shape === "O" ? 3 : 3, y: 0 };
    this.used++;
    this.fall = 0;
    this.lockMs = 0;
    if (!this.fits(this.piece)) {
      this.done = { won: false, stars: 0, score: this.score, checks: this.checks(false) };
      return [{ sfx: "hit", shake: 0.4, buzz: 250, toast: "The pile reached the crane!", tone: "bad" }];
    }
    return [];
  }

  fits(p: Piece): boolean {
    return cells(p).every(([x, y]) => x >= 0 && x < W && y < H && (y < 0 || !this.board[y]![x]));
  }

  private tryMove(dx: number, dy: number, drot = 0): boolean {
    const base = { ...this.piece, rot: this.piece.rot + drot };
    // wall kicks: sideways, then one up (rotations only)
    const kicks = drot ? [[0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1]] : [[0, 0]];
    for (const [kx, ky] of kicks) {
      const p = { ...base, x: base.x + dx + kx!, y: base.y + dy + ky! };
      if (this.fits(p)) {
        this.piece = p;
        if (dy === 0) this.lockMs = 0; // moving on the ground gives a little more time
        return true;
      }
    }
    return false;
  }

  ghostY(): number {
    let y = this.piece.y;
    while (this.fits({ ...this.piece, y: y + 1 })) y++;
    return y;
  }

  act(action: string): SimEvent[] {
    if (this.done || this.clearing) return [];
    switch (action) {
      case "left": return this.tryMove(-1, 0) ? [{ sfx: "move" }] : [];
      case "right": return this.tryMove(1, 0) ? [{ sfx: "move" }] : [];
      case "up": return this.tryMove(0, 0, 1) ? [{ sfx: "rotate" }] : [];
      case "down":
        if (this.tryMove(0, 1)) {
          this.score += 1;
          this.fall = 0;
          return [{ sfx: "move" }];
        }
        return this.lock();
      case "drop": {
        const y = this.ghostY();
        this.score += 2 * (y - this.piece.y);
        this.piece = { ...this.piece, y };
        return [{ sfx: "drop", shake: 0.15, buzz: 30 }, ...this.lock()];
      }
    }
    return [];
  }

  private lock(): SimEvent[] {
    const out: SimEvent[] = [{ sfx: "lock" }];
    for (const [x, y] of cells(this.piece)) {
      if (y < 0) {
        this.done = { won: false, stars: 0, score: this.score, checks: this.checks(false) };
        return [{ sfx: "hit", shake: 0.4, buzz: 250, toast: "The pile reached the crane!", tone: "bad" }];
      }
      this.board[y]![x] = SPRITE[this.piece.shape];
    }
    const full = this.board.map((row, y) => (row.every(Boolean) ? y : -1)).filter((y) => y >= 0);
    if (full.length) {
      this.combo++;
      const pts = LINE_POINTS[full.length]! * (this.index + 1) + (this.combo > 1 ? 50 * (this.combo - 1) : 0);
      this.score += pts;
      this.built += full.length;
      this.clearing = { rows: full, ms: 260 };
      out.push(full.length >= 4
        ? { sfx: "clear4", toast: "🏙️ Skyline bonus! 4 floors at once", tone: "good", shake: 0.3, buzz: 80 }
        : { sfx: "clear", toast: full.length > 1 ? `${full.length} floors built!` : undefined, tone: "good", buzz: 30 });
      return out;
    }
    this.combo = 0;
    return [...out, ...this.spawn()];
  }

  step(ms: number): SimEvent[] {
    if (this.done) return [];
    this.ms += ms;
    if (this.clearing) {
      this.clearing.ms -= ms;
      if (this.clearing.ms > 0) return [];
      const rows = new Set(this.clearing.rows);
      const keep = this.board.filter((_, y) => !rows.has(y));
      this.board = [...Array.from({ length: rows.size }, () => Array<string | null>(W).fill(null)), ...keep];
      this.clearing = null;
      if (this.built >= this.goal) return this.win();
      return this.spawn();
    }
    const grounded = !this.fits({ ...this.piece, y: this.piece.y + 1 });
    if (grounded) {
      this.lockMs += ms;
      if (this.lockMs >= LOCK_MS) return this.lock();
      return [];
    }
    this.fall += ms;
    while (this.fall >= this.fallMs) {
      this.fall -= this.fallMs;
      if (!this.tryMove(0, 1)) break;
    }
    return [];
  }

  private checks(won: boolean) {
    return [
      { text: `Build ${this.goal} floors`, ok: won },
      { text: `Score ${this.level.target.toLocaleString("en")}`, ok: won && this.score >= this.level.target },
      { text: `Use ${this.level.pieces} blocks or fewer`, ok: won && this.used <= this.level.pieces },
    ];
  }

  private win(): SimEvent[] {
    const checks = this.checks(true);
    this.done = { won: true, stars: checks.filter((c) => c.ok).length as 1 | 2 | 3, score: this.score, checks };
    return [];
  }

  outcome() {
    return this.done;
  }

  hud(): Hud {
    return { score: this.score, goal: `🏢 ${this.built} / ${this.goal} floors · 🧱 ${this.used}`, progress: this.built / this.goal, seconds: this.ms / 1000 };
  }

  debug() {
    return {
      piece: this.piece, cells: cells(this.piece), ghost: this.ghostY(), next: this.next.slice(0, 3), built: this.built, goal: this.goal,
      used: this.used, height: this.height(),
      board: this.board.map((r) => r.map((c) => (c ? (c === RUBBLE ? "r" : "#") : ".")).join("")),
    };
  }

  /** Rows from the floor to the top of the pile. */
  height(): number {
    const top = this.board.findIndex((r) => r.some(Boolean));
    return top < 0 ? 0 : H - top;
  }

  draw(d: Draw) {
    d.layer("stack-frame", this.cols, this.rows, (g) => {
      g.rect(0, 0, W, H, "rgba(10,20,45,0.75)", 0.2);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g.stroke(x + 0.05, y + 0.05, 0.9, 0.9, "rgba(255,255,255,0.05)", 0.03, 0.1);
      g.rect(W + 0.5, 0, PANEL - 0.5, 9, "rgba(10,20,45,0.6)", 0.3);
      g.text("NEXT", W + PANEL / 2 + 0.25, 0.9, 0.6, "#ffe27a");
      g.sprite("crane", W + PANEL / 2 - 0.5, 12.5, { scale: 1.6 });
    });
    const flash = this.clearing ? new Set(this.clearing.rows) : null;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = this.board[y]![x];
        if (!c) continue;
        if (flash?.has(y)) {
          d.rect(x, y, 1, 1, `rgba(255,255,220,${0.5 + 0.5 * Math.sin(d.t * 40)})`, 0.1);
          continue;
        }
        d.sprite(c, x + 0.5, y + 0.5, { scale: 1.06 });
      }
    }
    if (!this.done && !this.clearing) {
      const gy = this.ghostY();
      for (const [x, y] of cells({ ...this.piece, y: gy })) if (y >= 0) d.stroke(x + 0.08, y + 0.08, 0.84, 0.84, "rgba(255,255,255,0.45)", 0.06, 0.12);
      for (const [x, y] of cells(this.piece)) if (y >= 0) d.sprite(SPRITE[this.piece.shape], x + 0.5, y + 0.5, { scale: 1.06 });
    }
    this.next.slice(0, 3).forEach((s, i) => {
      const n = SHAPES[s];
      const minX = Math.min(...n.map((c) => c[0])), maxX = Math.max(...n.map((c) => c[0]));
      const k = i === 0 ? 0.8 : 0.6;
      const ox = W + 0.25 + PANEL / 2 - ((maxX - minX + 1) * k) / 2;
      const oy = 1.6 + i * 2.4;
      for (const [cx, cy] of n) d.sprite(SPRITE[s], ox + (cx - minX + 0.5) * k, oy + (cy + 0.5) * k, { scale: k * 1.06 });
    });
  }
}
