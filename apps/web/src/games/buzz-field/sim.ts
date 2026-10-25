/**
 * Buzz Field (single-player, hidden-hive logic puzzle). Beekeeper Bea is mowing paths across the meadow
 * for the Summer Fair, but wild bees have built hives under the turf. Every mowed patch shows how many hives
 * buzz next to it (all 8 neighbours). Mow every safe patch; mark the hives with flags so the fair-goers
 * steer clear.
 */
import type { Draw } from "../kitgrid/draw";
import { DELTA, rng, shuffle } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";

export interface FieldLevel {
  name: string;
  world: number;
  w: number;
  h: number;
  hives: number;
  /** Honey jars: a disturbed hive costs one instead of ending the level. */
  jars: number;
  /** Seconds for the second star. */
  par: number;
}

export const WORLDS = [
  {
    name: "World 1 · Clover Patch",
    text: "Bea the beekeeper is mowing paths for the Summer Fair, but wild bees have hidden their hives under the turf! Each mowed patch tells you how many hives are buzzing right next to it. Mow every safe patch and plant a flag on each hive. A honey jar calms an angry hive if you slip.",
  },
  {
    name: "World 2 · Sunflower Rows",
    text: "The sunflower fields are bigger and the bees are busier. Look for patterns: a 1 in a corner, a 1-2-1 along an edge... Every clue is there if you look closely.",
  },
  {
    name: "World 3 · The Royal Meadow",
    text: "The Queen Bee herself lives somewhere in this meadow! Fewer honey jars, more hives, and the Fair opens at noon. Show the bees you know where every one of them lives.",
  },
];

export const LEVELS: FieldLevel[] = [
  { name: "Daisy Corner", world: 0, w: 8, h: 6, hives: 5, jars: 2, par: 60 },
  { name: "Clover Lawn", world: 0, w: 9, h: 7, hives: 8, jars: 2, par: 90 },
  { name: "Picnic Green", world: 0, w: 10, h: 8, hives: 11, jars: 2, par: 120 },
  { name: "Sunflower Lane", world: 1, w: 11, h: 8, hives: 13, jars: 1, par: 140 },
  { name: "Tall Grass", world: 1, w: 12, h: 9, hives: 17, jars: 1, par: 170 },
  { name: "Scarecrow Hill", world: 1, w: 13, h: 9, hives: 20, jars: 1, par: 200 },
  { name: "Bluebell Bank", world: 2, w: 14, h: 10, hives: 24, jars: 1, par: 240 },
  { name: "Orchard Edge", world: 2, w: 15, h: 10, hives: 28, jars: 0, par: 280 },
  { name: "Rose Maze", world: 2, w: 16, h: 11, hives: 33, jars: 0, par: 330 },
  { name: "Queen's Meadow", world: 2, w: 16, h: 12, hives: 38, jars: 0, par: 380 },
];

const NUM_COLOUR = ["", "#2d6cdf", "#2e9a3c", "#e0503c", "#7a3bd1", "#a8541d", "#178a8a", "#222", "#666"];

export class FieldSim implements Sim {
  readonly cols: number;
  readonly rows: number;
  private r: () => number;
  /** null until the first dig, so the first patch (and its neighbours) is always safe. */
  hive: boolean[] | null = null;
  near: number[] = [];
  open: boolean[];
  flag: boolean[];
  cursor: [number, number];
  private hives: number;
  jars: number;
  stings = 0;
  ms = 0;
  score = 0;
  private done: Outcome | null = null;
  private quick: boolean;
  private burst: Array<{ i: number; ms: number }> = [];

  constructor(private level: FieldLevel, private index: number, seed: number, quick = false) {
    this.quick = quick;
    this.cols = quick ? 5 : level.w;
    this.rows = quick ? 5 : level.h;
    this.hives = quick ? 1 : level.hives;
    this.jars = level.jars;
    this.r = rng(seed);
    const n = this.cols * this.rows;
    this.open = Array<boolean>(n).fill(false);
    this.flag = Array<boolean>(n).fill(false);
    this.cursor = quick ? [0, 0] : [Math.floor(this.cols / 2), Math.floor(this.rows / 2)];
  }

  private i(x: number, y: number) {
    return y * this.cols + x;
  }

  neighbours(i: number): number[] {
    const x = i % this.cols, y = Math.floor(i / this.cols);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.cols && ny < this.rows) out.push(this.i(nx, ny));
      }
    }
    return out;
  }

  private plant(safe: number) {
    const n = this.cols * this.rows;
    this.hive = Array<boolean>(n).fill(false);
    if (this.quick) this.hive[n - 1] = true;
    else {
      const keep = new Set([safe, ...this.neighbours(safe)]);
      const spots = shuffle(this.r, [...Array(n).keys()].filter((i) => !keep.has(i)));
      for (const i of spots.slice(0, this.hives)) this.hive[i] = true;
    }
    this.near = [...Array(n).keys()].map((i) => this.neighbours(i).filter((j) => this.hive![j]).length);
  }

  act(action: string): SimEvent[] {
    if (this.done) return [];
    if (action in DELTA) {
      const [dx, dy] = DELTA[action as keyof typeof DELTA];
      const x = Math.max(0, Math.min(this.cols - 1, this.cursor[0] + dx));
      const y = Math.max(0, Math.min(this.rows - 1, this.cursor[1] + dy));
      if (x === this.cursor[0] && y === this.cursor[1]) return [];
      this.cursor = [x, y];
      return [{ sfx: "move" }];
    }
    const at = this.i(...this.cursor);
    if (action === "flag") {
      if (this.open[at]) return [];
      this.flag[at] = !this.flag[at];
      return [{ sfx: this.flag[at] ? "flag" : "unflag", buzz: 15 }];
    }
    if (action === "dig") return this.dig(at);
    return [];
  }

  private dig(at: number): SimEvent[] {
    if (this.flag[at]) return [{ sfx: "unflag", toast: "There's a flag here: tap 🚩 to lift it first", tone: "info" }];
    if (!this.hive) this.plant(at);
    if (this.open[at]) {
      // chord: a number whose hives are all flagged mows the rest of its neighbours
      const nb = this.neighbours(at);
      if (this.near[at]! > 0 && nb.filter((j) => this.flag[j]).length === this.near[at]) {
        const out: SimEvent[] = [];
        for (const j of nb) if (!this.open[j] && !this.flag[j]) out.push(...this.reveal(j));
        return out.length ? out : [];
      }
      return [];
    }
    return this.reveal(at);
  }

  private reveal(at: number): SimEvent[] {
    if (this.done || this.open[at]) return [];
    if (this.hive![at]) {
      this.stings++;
      this.burst.push({ i: at, ms: 1500 });
      if (this.jars > 0) {
        this.jars--;
        this.flag[at] = true; // the calmed hive is marked for you
        return [{ sfx: "hit", shake: 0.3, buzz: 200, toast: `🍯 A honey jar calmed the bees! ${this.jars} left`, tone: "bad" }];
      }
      this.open[at] = true;
      this.done = { won: false, stars: 0, score: this.score, checks: this.checks(false) };
      return [{ sfx: "lose", shake: 0.5, buzz: 300, toast: "🐝 Buzz! The bees chased Bea off", tone: "bad" }];
    }
    // flood: open patches spread across zeros
    const stack = [at];
    let opened = 0;
    while (stack.length) {
      const i = stack.pop()!;
      if (this.open[i] || this.flag[i] || this.hive![i]) continue;
      this.open[i] = true;
      opened++;
      if (this.near[i] === 0) for (const j of this.neighbours(i)) if (!this.open[j]) stack.push(j);
    }
    this.score += opened * 5 * (this.index + 1);
    const out: SimEvent[] = [{ sfx: "dig" }];
    if (opened > 8) out.push({ sfx: "clear" });
    if (this.safeLeft() === 0) out.push(...this.win());
    return out;
  }

  safeLeft(): number {
    if (!this.hive) return this.cols * this.rows - this.hives;
    return this.open.filter((o, i) => !o && !this.hive![i]).length;
  }

  step(ms: number): SimEvent[] {
    if (this.done) return [];
    if (this.hive) this.ms += ms; // the clock starts with the first dig
    this.burst = this.burst.filter((b) => (b.ms -= ms) > 0);
    return [];
  }

  private checks(won: boolean) {
    const allFlagged = !!this.hive && this.hive.every((h, i) => !h || this.flag[i]) && this.flag.every((f, i) => !f || this.hive![i]);
    return [
      { text: "Mow every safe patch", ok: won },
      { text: `Finish in ${this.level.par} s`, ok: won && this.ms / 1000 <= this.level.par },
      { text: "Flag every hive, with no wrong flags or stings", ok: won && allFlagged && this.stings === 0 },
    ];
  }

  private win(): SimEvent[] {
    const checks = this.checks(true);
    this.score += Math.max(0, Math.round((this.level.par - this.ms / 1000) * 10)) + this.jars * 200;
    this.done = { won: true, stars: checks.filter((c) => c.ok).length as 1 | 2 | 3, score: this.score, checks };
    return [];
  }

  outcome() {
    return this.done;
  }

  hud(): Hud {
    const total = this.cols * this.rows - this.hives;
    const flags = this.flag.filter(Boolean).length;
    return {
      score: this.score, goal: `🌱 ${total - this.safeLeft()} / ${total} · 🚩 ${flags} / ${this.hives} · 🍯 ${this.jars}`,
      progress: (total - this.safeLeft()) / total, seconds: this.ms / 1000,
    };
  }

  debug() {
    return {
      cursor: this.cursor, cols: this.cols, rows: this.rows, safeLeft: this.safeLeft(), jars: this.jars, stings: this.stings,
      planted: !!this.hive, flags: this.flag.filter(Boolean).length,
      view: Array.from({ length: this.rows }, (_, y) => Array.from({ length: this.cols }, (_, x) => {
        const i = this.i(x, y);
        return this.flag[i] ? "F" : this.open[i] ? String(this.near[i]) : "#";
      }).join("")),
    };
  }

  draw(d: Draw) {
    const over = !!this.done;
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const i = this.i(x, y);
        const cx = x + 0.5, cy = y + 0.5;
        if (this.open[i] && !this.hive?.[i]) {
          d.sprite("soil", cx, cy);
          const n = this.near[i]!;
          if (n > 0) d.text(String(n), cx, cy + 0.02, 0.62, NUM_COLOUR[n]!, 900);
          else if ((x * 7 + y * 3) % 5 === 0) d.sprite((x + y) % 2 ? "flower-pink" : "flower-white", cx + 0.2, cy + 0.15, { scale: 0.7 });
          continue;
        }
        d.sprite("turf", cx, cy);
        if (over && this.hive?.[i]) d.sprite(this.open[i] ? "hive-awake" : "hive", cx, cy, { scale: 0.9 });
        if (this.flag[i]) d.sprite("marker", cx, cy, { scale: 0.85 });
        if (over && this.flag[i] && this.hive && !this.hive[i]) d.text("✕", cx, cy, 0.8, "#e0503c", 900);
      }
    }
    for (const b of this.burst) {
      const x = (b.i % this.cols) + 0.5, y = Math.floor(b.i / this.cols) + 0.5;
      for (let k = 0; k < 5; k++) {
        const a = d.t * 6 + k * 1.26;
        d.sprite("bee", x + Math.cos(a) * 0.6, y + Math.sin(a * 1.3) * 0.5, { scale: 0.5 });
      }
    }
    if (!over) {
      const [x, y] = this.cursor;
      const pulse = 0.06 + 0.02 * Math.sin(d.t * 8);
      d.stroke(x + 0.04, y + 0.04, 0.92, 0.92, "#ffe27a", pulse + 0.04, 0.18);
    }
  }
}
