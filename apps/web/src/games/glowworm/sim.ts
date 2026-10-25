/**
 * Glowworm Grove: the simulation (pure, seeded, no DOM). Glo moves one cell per step; eating a firefly grows
 * Glo by one and speeds up the steps a little. Crashing into a hedge or Glo's own body costs a life and
 * puts Glo back at the start (fireflies and lanterns already done stay done).
 */
import type { Draw } from "../kitgrid/draw";
import { DELTA, OPPOSITE, ANGLE, rng, type Dir } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import { COLS, ROWS, type WormLevel } from "./levels";

type Cell = [number, number];
export const LIVES = 3;
const START_LEN = 3;
/** Every fifth firefly is a golden one: worth more, and it flies off after a while. */
const GOLD_EVERY = 5;
const GOLD_MS = 7000;
const READY_MS = 900;

export interface WormMap {
  wrap: boolean;
  hedge: boolean[];
  lanterns: Cell[];
  burrows: Map<number, Cell>; // cell index → exit cell
  start: Cell;
}

export function parseMap(rows: string[]): WormMap {
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) throw new Error("garden must be 24 × 14");
  const hedge: boolean[] = [];
  const lanterns: Cell[] = [];
  const holes = new Map<string, Cell[]>();
  let start: Cell | null = null;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      hedge.push(ch === "#");
      if (ch === "L") lanterns.push([x, y]);
      else if (ch === "S") start = [x, y];
      else if (ch === "a" || ch === "b") holes.set(ch, [...(holes.get(ch) ?? []), [x, y]]);
      else if (ch !== "#" && ch !== ".") throw new Error(`unknown garden tile "${ch}"`);
    });
  });
  if (!start) throw new Error("garden has no S");
  const burrows = new Map<number, Cell>();
  for (const [k, pair] of holes) {
    if (pair.length !== 2) throw new Error(`burrow ${k} needs exactly two ends`);
    burrows.set(pair[0]![1] * COLS + pair[0]![0], pair[1]!);
    burrows.set(pair[1]![1] * COLS + pair[1]![0], pair[0]!);
  }
  // no hedge border (top row not all hedge) = the garden wraps around its edges
  const wrap = ![...rows[0]!].every((c) => c === "#");
  return { wrap, hedge, lanterns, burrows, start };
}

export class WormSim implements Sim {
  readonly cols = COLS;
  readonly rows = ROWS;
  private map: WormMap;
  private r: () => number;
  worm: Cell[] = [];
  private prev: Cell[] = [];
  dir: Dir = "right";
  private queue: Dir[] = [];
  private grow = 0;
  private acc = 0;
  private ready = READY_MS;
  firefly: Cell = [0, 0];
  gold: { at: Cell; ms: number } | null = null;
  eaten = 0;
  lit = new Set<number>();
  lives = LIVES;
  crashes = 0;
  score = 0;
  ms = 0;
  private done: Outcome | null = null;
  private spawned = 0;
  readonly goal: number;
  private flash = 0;

  constructor(private level: WormLevel, private index: number, seed: number, private skin = "", private quick = false) {
    this.map = parseMap(level.map);
    this.r = rng(seed);
    this.goal = quick ? 2 : level.goal;
    this.respawn();
    this.firefly = this.nextFirefly();
  }

  /** Quick (test/demo) runs drop each firefly straight ahead of Glo so no steering is needed. */
  private nextFirefly(): Cell {
    if (this.quick) {
      const [x, y] = this.worm[0]!;
      const ahead: Cell = [x + 3, y];
      if (ahead[0] < COLS && !this.blocked(ahead)) return ahead;
    }
    return this.freeCell();
  }

  get stepMs() {
    return Math.max(this.level.stepMs * 0.7, this.level.stepMs * 0.985 ** this.eaten);
  }

  private respawn() {
    this.worm = [[...this.map.start]];
    this.prev = [[...this.map.start]];
    this.grow = START_LEN - 1;
    this.dir = "right";
    this.queue = [];
    this.acc = 0;
    this.ready = READY_MS;
  }

  private idx(c: Cell) {
    return c[1] * COLS + c[0];
  }

  private blocked(c: Cell): boolean {
    return this.map.hedge[this.idx(c)]!;
  }

  private freeCell(): Cell {
    const busy = new Set(this.worm.map((c) => this.idx(c)));
    for (const l of this.map.lanterns) busy.add(this.idx(l));
    for (const k of this.map.burrows.keys()) busy.add(k);
    if (this.gold) busy.add(this.idx(this.gold.at));
    busy.add(this.idx(this.firefly));
    // keep spawns away from Glo's nose so a firefly never appears where Glo will crash into it
    const [hx, hy] = this.worm[0]!;
    const free: Cell[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c: Cell = [x, y];
        if (this.blocked(c) || busy.has(this.idx(c))) continue;
        if (Math.abs(x - hx) + Math.abs(y - hy) < 3) continue;
        free.push(c);
      }
    }
    return free[Math.floor(this.r() * free.length)] ?? [1, 1];
  }

  act(action: string): SimEvent[] {
    if (action !== "up" && action !== "down" && action !== "left" && action !== "right") return [];
    const d = action as Dir;
    const last = this.queue[this.queue.length - 1] ?? this.dir;
    if (d === last || (d === OPPOSITE[last] && this.worm.length > 1)) return [];
    if (this.queue.length < 2) this.queue.push(d);
    return [{ sfx: "turn" }];
  }

  step(ms: number): SimEvent[] {
    if (this.done) return [];
    this.ms += ms;
    this.flash = Math.max(0, this.flash - ms);
    const out: SimEvent[] = [];
    if (this.gold) {
      this.gold.ms -= ms;
      if (this.gold.ms <= 0) this.gold = null;
    }
    if (this.ready > 0) {
      this.ready -= ms;
      return out;
    }
    this.acc += ms;
    while (this.acc >= this.stepMs && !this.done) {
      this.acc -= this.stepMs;
      out.push(...this.move());
    }
    return out;
  }

  private move(): SimEvent[] {
    const out: SimEvent[] = [];
    const next = this.queue.shift();
    if (next) this.dir = next;
    const [dx, dy] = DELTA[this.dir];
    let [x, y] = this.worm[0]!;
    x += dx;
    y += dy;
    if (this.map.wrap) {
      x = (x + COLS) % COLS;
      y = (y + ROWS) % ROWS;
    }
    let head: Cell = [x, y];
    const out_of_bounds = x < 0 || y < 0 || x >= COLS || y >= ROWS;
    // the tail moves away this step unless Glo is growing, so moving into it is fine
    const body = this.grow > 0 ? this.worm : this.worm.slice(0, -1);
    if (out_of_bounds || this.blocked(head) || body.some((c) => c[0] === x && c[1] === y)) return this.crash();
    const exit = this.map.burrows.get(this.idx(head));
    if (exit) {
      head = [...exit];
      out.push({ sfx: "warp" });
    }
    this.prev = this.worm.map((c) => [...c] as Cell);
    this.worm.unshift(head);
    if (this.grow > 0) this.grow--;
    else this.worm.pop();
    this.prev.unshift(this.prev[0]!); // the new head slides out of the old head's cell
    if (this.prev.length > this.worm.length) this.prev.length = this.worm.length;

    const hi = this.idx(head);
    for (const l of this.map.lanterns) {
      if (this.idx(l) === hi && !this.lit.has(hi)) {
        this.lit.add(hi);
        this.score += 100;
        out.push({ sfx: "light", toast: `🏮 Lantern ${this.lit.size} / ${this.map.lanterns.length} lit!`, tone: "good", buzz: 30 });
      }
    }
    if (this.gold && this.idx(this.gold.at) === hi) {
      this.gold = null;
      this.grow += 1;
      this.score += 50 * (this.index + 1);
      out.push({ sfx: "bonus", toast: "✨ Golden firefly!", tone: "good", buzz: 40 });
    }
    if (this.idx(this.firefly) === hi) {
      this.eaten++;
      this.grow += 1;
      this.score += 10 * (this.index + 1);
      this.flash = 250;
      out.push({ sfx: "eat", buzz: 20 });
      if (this.eaten >= this.goal) return [...out, ...this.win()];
      this.spawned++;
      this.firefly = this.nextFirefly();
      if (this.spawned % GOLD_EVERY === 0 && !this.gold) this.gold = { at: this.freeCell(), ms: GOLD_MS };
    }
    return out;
  }

  private crash(): SimEvent[] {
    this.lives--;
    this.crashes++;
    if (this.lives <= 0) {
      this.done = { won: false, stars: 0, score: this.score, checks: this.checks(false) };
      return [{ sfx: "hit", shake: 0.5, buzz: 200, toast: "Out of lives!", tone: "bad" }];
    }
    this.respawn();
    return [{ sfx: "hit", shake: 0.4, buzz: 150, toast: `Bump! ${this.lives} ${this.lives === 1 ? "life" : "lives"} left`, tone: "bad" }];
  }

  private checks(won: boolean) {
    const allLit = this.lit.size === this.map.lanterns.length;
    const fast = this.ms / 1000 <= this.level.par;
    return [
      { text: `Eat ${this.goal} fireflies`, ok: won },
      { text: `Light all ${this.map.lanterns.length} lanterns`, ok: won && allLit },
      { text: `Finish in ${this.level.par} s without a bump`, ok: won && fast && this.crashes === 0 },
    ];
  }

  private win(): SimEvent[] {
    const checks = this.checks(true);
    const stars = checks.filter((c) => c.ok).length as 1 | 2 | 3;
    const timeBonus = Math.max(0, Math.round((this.level.par - this.ms / 1000) * 5));
    this.score += timeBonus + this.lives * 50;
    this.done = { won: true, stars, score: this.score, checks };
    return [{ sfx: "clear" }];
  }

  outcome() {
    return this.done;
  }

  hud(): Hud {
    return {
      score: this.score, goal: `🪲 ${this.eaten} / ${this.goal} · 🏮 ${this.lit.size} / ${this.map.lanterns.length}`,
      progress: this.eaten / this.goal, lives: this.lives, seconds: this.ms / 1000,
    };
  }

  debug() {
    return {
      worm: this.worm, dir: this.dir, firefly: this.firefly, gold: this.gold?.at ?? null, eaten: this.eaten, goal: this.goal,
      lit: this.lit.size, lanterns: this.map.lanterns.length, lives: this.lives, wrap: this.map.wrap, ready: this.ready > 0,
      hedges: this.map.hedge.map((h, i) => (h ? i : -1)).filter((i) => i >= 0),
      burrows: [...this.map.burrows.entries()].map(([k, v]) => [k % COLS, Math.floor(k / COLS), v[0], v[1]]),
    };
  }

  draw(d: Draw) {
    const m = this.map;
    d.layer(`worm-ground-${this.index}`, COLS, ROWS, (g) => {
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) g.rect(x, y, 1, 1, (x + y) % 2 ? "#2f6b3a" : "#356f40");
      }
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (m.hedge[y * COLS + x]) g.sprite("hedge", x + 0.5, y + 0.5);
    });
    for (const [k] of m.burrows) d.sprite("burrow", (k % COLS) + 0.5, Math.floor(k / COLS) + 0.5, { phase: k * 0.1 });
    for (const l of m.lanterns) {
      const on = this.lit.has(this.idx(l));
      d.sprite(on ? "lantern-on" : "lantern-off", l[0] + 0.5, l[1] + 0.5, { scale: on ? 1 + 0.04 * Math.sin(d.t * 4) : 1 });
    }
    d.sprite("firefly", this.firefly[0] + 0.5, this.firefly[1] + 0.5 + 0.06 * Math.sin(d.t * 5));
    if (this.gold) {
      const blink = this.gold.ms < 2000 && Math.floor(this.gold.ms / 150) % 2 === 0;
      if (!blink) d.sprite("firefly", this.gold.at[0] + 0.5, this.gold.at[1] + 0.5, { scale: 1.5, phase: 0.3 });
      if (!blink) d.circle(this.gold.at[0] + 0.5, this.gold.at[1] + 0.4, 0.45, "rgba(255,215,64,0.25)");
    }
    // the worm slides between cells; segments that wrap or warp jump instead of sliding across the board
    const f = this.ready > 0 ? 1 : Math.min(1, this.acc / this.stepMs);
    const pos = (i: number): [number, number] => {
      const a = this.prev[i] ?? this.worm[i]!;
      const b = this.worm[i]!;
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1) return [b[0] + 0.5, b[1] + 0.5];
      return [a[0] + (b[0] - a[0]) * f + 0.5, a[1] + (b[1] - a[1]) * f + 0.5];
    };
    const sk = this.skin;
    const blink = this.ready > 0 && Math.floor(this.ready / 120) % 2 === 0;
    if (!blink) {
      for (let i = this.worm.length - 1; i >= 1; i--) {
        const [x, y] = pos(i);
        d.sprite(i === this.worm.length - 1 ? `worm-tail${sk}` : `worm-body${sk}`, x, y, { scale: 1 - Math.min(0.25, i * 0.01) });
      }
      const [hx, hy] = pos(0);
      d.sprite(`worm-head${sk}`, hx, hy, { rot: ANGLE[this.dir], scale: this.flash > 0 ? 1.15 : 1 });
    }
  }
}
