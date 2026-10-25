/**
 * Comet Kitty: the simulation. Everyone moves one cell at a time on the maze. Kitty keeps going in a
 * direction and takes a queued turn at the first chance; dustbots pick, at every cell, the open way (never
 * straight back) that gets them closest to their target, which depends on the bot and on the phase (patrol
 * corners / chase). A nova star overloads them: they wander slowly, and Kitty can bonk them back to the dock.
 */
import type { Draw } from "../kitgrid/draw";
import { DELTA, DIRS, OPPOSITE, rng, type Dir } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import { COLS, MAZES, ROWS, type KittyLevel } from "./levels";

type Cell = [number, number];
export const LIVES = 3;
const BOT_IDS = ["bot-red", "bot-pink", "bot-cyan", "bot-amber"] as const;
const BOT_NAMES = ["Rusty", "Rosie", "Sparky", "Buzz"];
/** Patrol → chase phases (ms); the last chase lasts forever. */
const PHASES = [6000, 20000, 6000, 20000, 5000];
const RELEASE_MS = [0, 1500, 5000, 9000];
const DOCK_MS = 2500;
const READY_MS = 1500;
const COMET_AT = [50, 110];
const COMET_MS = 9000;

export interface Maze {
  wall: boolean[];
  /** Cells only dustbots may enter (dock and its door). */
  dock: boolean[];
  dust: Set<number>;
  nova: Set<number>;
  kitty: Cell;
  dockCells: Cell[];
  door: Cell;
}

export function parseMaze(rows: string[]): Maze {
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) throw new Error("maze must be 19 × 21");
  const wall: boolean[] = [], dock: boolean[] = [];
  const dust = new Set<number>(), nova = new Set<number>();
  const dockCells: Cell[] = [];
  let kitty: Cell | null = null, door: Cell | null = null;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const i = y * COLS + x;
    wall.push(ch === "#");
    dock.push(ch === "D" || ch === "-");
    if (ch === ".") dust.add(i);
    else if (ch === "o") nova.add(i);
    else if (ch === "K") kitty = [x, y];
    else if (ch === "D") dockCells.push([x, y]);
    else if (ch === "-") door = [x, y];
    else if (ch !== "#" && ch !== " ") throw new Error(`unknown maze tile "${ch}"`);
  }));
  if (!kitty || !door || !dockCells.length) throw new Error("maze needs K, D and -");
  return { wall, dock, dust, nova, kitty, dockCells, door };
}

interface Mover { at: Cell; prev: Cell; dir: Dir; acc: number }

interface Bot extends Mover {
  n: number;
  /** ms until it leaves the dock (0 = out or leaving). */
  wait: number;
  state: "dock" | "leaving" | "out";
}

const idx = (c: Cell) => c[1] * COLS + c[0];
const dist2 = (a: Cell, b: Cell) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

export class KittySim implements Sim {
  readonly cols = COLS;
  readonly rows = ROWS;
  private m: Maze;
  private r: () => number;
  kitty: Mover;
  private want: Dir | null = null;
  bots: Bot[] = [];
  private total: number;
  eaten = 0;
  lives = LIVES;
  lost = 0;
  bonks = 0;
  private chain = 0;
  power = 0;
  private phaseMs = 0;
  private phase = 0;
  score = 0;
  ms = 0;
  private ready = READY_MS;
  comet: { at: Cell; ms: number } | null = null;
  private cometsShown = 0;
  private done: Outcome | null = null;
  private facing: "left" | "right" = "left";
  private pops: Array<{ at: Cell; text: string; ms: number }> = [];

  constructor(private level: KittyLevel, private index: number, seed: number, private skin = "", quick = false) {
    this.m = parseMaze(MAZES[level.maze]!);
    this.r = rng(seed);
    if (quick) {
      // tests: three specks straight to Kitty's left and no dustbots
      const [kx, ky] = this.m.kitty;
      this.m.dust = new Set([1, 2, 3].map((d) => ky * COLS + kx - d));
      this.m.nova = new Set();
    }
    this.total = this.m.dust.size + this.m.nova.size;
    this.kitty = this.mover(this.m.kitty, "left");
    const bots = quick ? 0 : level.bots;
    for (let n = 0; n < bots; n++) this.bots.push(this.newBot(n));
  }

  private mover(at: Cell, dir: Dir): Mover {
    return { at: [...at], prev: [...at], dir, acc: 0 };
  }

  private newBot(n: number): Bot {
    if (n === 0) {
      const above: Cell = [this.m.door[0], this.m.door[1] - 1];
      return { ...this.mover(above, "left"), n, wait: 0, state: "out" };
    }
    const c = this.m.dockCells[(n - 1) % this.m.dockCells.length]!;
    return { ...this.mover(c, "up"), n, wait: RELEASE_MS[n]!, state: "dock" };
  }

  private open(c: Cell, bot: boolean): boolean {
    const i = idx(c);
    if (c[1] < 0 || c[1] >= ROWS) return false;
    if (this.m.wall[i]) return false;
    return bot || !this.m.dock[i];
  }

  private ahead(c: Cell, d: Dir, n = 1): Cell {
    const [dx, dy] = DELTA[d];
    return [(((c[0] + dx * n) % COLS) + COLS) % COLS, c[1] + dy * n];
  }

  act(action: string): SimEvent[] {
    if (!(DIRS as string[]).includes(action)) return [];
    this.want = action as Dir;
    return [];
  }

  private get chasing() {
    return this.phase % 2 === 1 || this.phase >= PHASES.length;
  }

  step(ms: number): SimEvent[] {
    if (this.done) return [];
    const out: SimEvent[] = [];
    this.ms += ms;
    this.pops = this.pops.filter((p) => (p.ms -= ms) > 0);
    if (this.ready > 0) {
      this.ready -= ms;
      return out;
    }
    if (this.power > 0) {
      this.power -= ms;
      if (this.power <= 0) this.chain = 0;
    } else if (this.phase < PHASES.length) {
      this.phaseMs += ms;
      if (this.phaseMs >= PHASES[this.phase]!) {
        this.phaseMs = 0;
        this.phase++;
        for (const b of this.bots) if (b.state === "out") b.dir = OPPOSITE[b.dir];
      }
    }
    if (this.comet && (this.comet.ms -= ms) <= 0) this.comet = null;

    // Kitty
    this.kitty.acc += ms;
    while (this.kitty.acc >= this.level.kittyMs) {
      this.kitty.acc -= this.level.kittyMs;
      out.push(...this.moveKitty());
      out.push(...this.collide());
      if (this.done || this.ready > 0) return out;
    }
    // dustbots
    for (const b of this.bots) {
      if (b.state === "dock") {
        b.prev = [...b.at];
        b.wait -= ms;
        if (b.wait <= 0) b.state = "leaving";
        continue;
      }
      const tunnel = b.at[1] === 9 && (b.at[0] < 4 || b.at[0] > 14);
      const speed = this.level.botMs * (this.power > 0 ? 1.6 : 1) * (tunnel ? 1.5 : 1);
      b.acc += ms;
      while (b.acc >= speed) {
        b.acc -= speed;
        this.moveBot(b);
        out.push(...this.collide());
        if (this.done || this.ready > 0) return out;
      }
    }
    return out;
  }

  private moveKitty(): SimEvent[] {
    const k = this.kitty;
    k.prev = [...k.at];
    if (this.want && this.open(this.ahead(k.at, this.want), false)) {
      k.dir = this.want;
      this.want = null;
    }
    const next = this.ahead(k.at, k.dir);
    if (!this.open(next, false)) return [];
    k.at = next;
    if (k.dir === "left" || k.dir === "right") this.facing = k.dir;
    const i = idx(next);
    const out: SimEvent[] = [];
    if (this.m.dust.delete(i)) {
      this.eaten++;
      this.score += 10;
      if (this.eaten % 4 === 0) out.push({ sfx: "eat" });
    } else if (this.m.nova.delete(i)) {
      this.eaten++;
      this.score += 50;
      this.power = this.level.powerMs;
      this.chain = 0;
      for (const b of this.bots) if (b.state === "out") b.dir = OPPOSITE[b.dir];
      out.push({ sfx: "power", toast: "🌟 Nova! Bonk the dustbots!", tone: "good", buzz: 60 });
    }
    if (COMET_AT[this.cometsShown] !== undefined && this.eaten >= COMET_AT[this.cometsShown]!) {
      this.cometsShown++;
      this.comet = { at: [9, 11], ms: COMET_MS };
      out.push({ sfx: "bonus", toast: "☄️ A comet! Grab it below the dock", tone: "info" });
    }
    if (this.comet && idx(this.comet.at) === i) {
      const pts = 500 * (this.index + 1);
      this.score += pts;
      this.pops.push({ at: this.comet.at, text: `+${pts}`, ms: 1200 });
      this.comet = null;
      out.push({ sfx: "bonus", buzz: 40 });
    }
    if (this.eaten >= this.total) out.push(...this.win());
    return out;
  }

  private target(b: Bot): Cell {
    const k = this.kitty.at;
    const corner: Cell[] = [[COLS - 2, -2], [1, -2], [COLS - 1, ROWS], [0, ROWS]];
    if (!this.chasing) return corner[b.n]!;
    switch (b.n) {
      case 0: return k;
      case 1: return this.ahead(k, this.kitty.dir, 4);
      case 2: {
        const p = this.ahead(k, this.kitty.dir, 2);
        const red = this.bots[0]?.at ?? p;
        return [2 * p[0] - red[0], 2 * p[1] - red[1]];
      }
      default: return dist2(b.at, k) > 64 ? k : corner[3]!;
    }
  }

  private moveBot(b: Bot) {
    b.prev = [...b.at];
    if (b.state === "leaving") {
      // straight to the door, then up out of it
      const [dx] = this.m.door;
      if (b.at[0] !== dx) b.at = [b.at[0] + Math.sign(dx - b.at[0]), b.at[1]];
      else b.at = [b.at[0], b.at[1] - 1];
      if (!this.m.dock[idx(b.at)]) {
        b.state = "out";
        b.dir = this.r() < 0.5 ? "left" : "right";
      }
      return;
    }
    const options = DIRS.filter((d) => d !== OPPOSITE[b.dir] && this.open(this.ahead(b.at, d), false));
    if (!options.length) options.push(OPPOSITE[b.dir]);
    let d: Dir;
    if (this.power > 0) d = options[Math.floor(this.r() * options.length)]!;
    else {
      const t = this.target(b);
      d = options.reduce((best, o) => (dist2(this.ahead(b.at, o), t) < dist2(this.ahead(b.at, best), t) ? o : best));
    }
    b.dir = d;
    b.at = this.ahead(b.at, d);
  }

  private collide(): SimEvent[] {
    const k = this.kitty;
    for (const b of this.bots) {
      if (b.state !== "out") continue;
      const same = idx(b.at) === idx(k.at);
      const swapped = idx(b.at) === idx(k.prev) && idx(b.prev) === idx(k.at);
      if (!same && !swapped) continue;
      if (this.power > 0) {
        this.chain++;
        this.bonks++;
        const pts = 200 * 2 ** Math.min(3, this.chain - 1);
        this.score += pts;
        this.pops.push({ at: [...b.at], text: `+${pts}`, ms: 1000 });
        Object.assign(b, this.mover(this.m.dockCells[1] ?? this.m.dockCells[0]!, "up"), { wait: DOCK_MS, state: "dock" });
        return [{ sfx: "hit", toast: `💥 Bonked ${BOT_NAMES[b.n]}!`, tone: "good", shake: 0.2, buzz: 50 }];
      }
      return this.loseLife();
    }
    return [];
  }

  private loseLife(): SimEvent[] {
    this.lives--;
    this.lost++;
    if (this.lives <= 0) {
      this.done = { won: false, stars: 0, score: this.score, checks: this.checks(false) };
      return [{ sfx: "lose", shake: 0.5, buzz: 250, toast: "Caught! Out of lives", tone: "bad" }];
    }
    this.kitty = this.mover(this.m.kitty, "left");
    this.want = null;
    this.bots = this.bots.map((b) => this.newBot(b.n));
    this.power = 0;
    this.ready = READY_MS;
    return [{ sfx: "hit", shake: 0.4, buzz: 180, toast: `Caught! ${this.lives} ${this.lives === 1 ? "life" : "lives"} left`, tone: "bad" }];
  }

  private checks(won: boolean) {
    return [
      { text: "Collect all the stardust", ok: won },
      { text: "Don't get caught", ok: won && this.lost === 0 },
      { text: `Bonk ${this.level.bonks} dustbot${this.level.bonks > 1 ? "s" : ""}`, ok: won && this.bonks >= this.level.bonks },
    ];
  }

  private win(): SimEvent[] {
    const checks = this.checks(true);
    this.score += this.lives * 300;
    this.done = { won: true, stars: checks.filter((c) => c.ok).length as 1 | 2 | 3, score: this.score, checks };
    return [{ sfx: "clear" }];
  }

  outcome() {
    return this.done;
  }

  hud(): Hud {
    return {
      score: this.score, goal: `✨ ${this.eaten} / ${this.total} · 💥 ${this.bonks}`, progress: this.eaten / this.total,
      lives: this.lives, seconds: this.ms / 1000,
    };
  }

  debug() {
    return {
      kitty: this.kitty.at, dir: this.kitty.dir, eaten: this.eaten, total: this.total, lives: this.lives, power: this.power > 0,
      bots: this.bots.map((b) => ({ at: b.at, state: b.state })), chasing: this.chasing, ready: this.ready > 0, bonks: this.bonks,
    };
  }

  draw(d: Draw) {
    const m = this.m;
    d.layer(`kitty-maze-${this.level.maze}`, COLS, ROWS, (g) => {
      g.rect(0, 0, COLS, ROWS, "#0a0f2e");
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const i = y * COLS + x;
          if (!m.wall[i]) continue;
          g.rect(x + 0.08, y + 0.08, 0.84, 0.84, "#23307a", 0.18);
          // join neighbouring walls so corridors read as solid hull
          if (x + 1 < COLS && m.wall[i + 1]) g.rect(x + 0.5, y + 0.08, 1, 0.84, "#23307a");
          if (y + 1 < ROWS && m.wall[i + COLS]) g.rect(x + 0.08, y + 0.5, 0.84, 1, "#23307a");
        }
      }
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          if (m.wall[y * COLS + x]) g.stroke(x + 0.2, y + 0.2, 0.6, 0.6, "rgba(120,170,255,0.35)", 0.05, 0.15);
        }
      }
      g.rect(m.door[0] + 0.1, m.door[1] + 0.42, 0.8, 0.16, "#ff8bd1");
    });
    for (const i of m.dust) d.sprite("dust", (i % COLS) + 0.5, Math.floor(i / COLS) + 0.5);
    for (const i of m.nova) d.sprite("dust-big", (i % COLS) + 0.5, Math.floor(i / COLS) + 0.5, { scale: 1 + 0.15 * Math.sin(d.t * 6) });
    if (this.comet) d.sprite("comet", this.comet.at[0] + 0.5, this.comet.at[1] + 0.5);

    const lerp = (mv: Mover, every: number): [number, number] => {
      const f = Math.min(1, mv.acc / every);
      const [ax, ay] = mv.prev, [bx, by] = mv.at;
      if (Math.abs(ax - bx) > 1) return [bx + 0.5, by + 0.5]; // tunnel warp
      return [ax + (bx - ax) * f + 0.5, ay + (by - ay) * f + 0.5];
    };
    const scaredBlink = this.power > 0 && this.power < 1500 && Math.floor(this.power / 160) % 2 === 0;
    for (const b of this.bots) {
      const [x, y] = lerp(b, this.level.botMs * (this.power > 0 ? 1.6 : 1));
      const scared = this.power > 0 && b.state === "out";
      d.sprite(scared && !scaredBlink ? "bot-scared" : BOT_IDS[b.n]!, x, y, { phase: b.n * 0.13, alpha: b.state === "dock" ? 0.7 : 1 });
    }
    const blink = this.ready > 0 && Math.floor(this.ready / 150) % 2 === 0;
    if (!blink) {
      const [kx, ky] = lerp(this.kitty, this.level.kittyMs);
      d.sprite(`kitty${this.skin}`, kx, ky, { flipX: this.facing === "left", frame: this.ready > 0 ? 0 : undefined });
    }
    for (const p of this.pops) d.text(p.text, p.at[0] + 0.5, p.at[1] + 0.2 - (1 - p.ms / 1000) * 0.6, 0.6, "#ffe27a");
    if (this.ready > 0 && this.ms < READY_MS + 50) d.text("READY!", COLS / 2, 11.5, 0.9, "#ffe27a", 900);
  }
}
