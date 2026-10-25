/**
 * kitplat/builder: author levels as a walk from left to right instead of drawing every ASCII row by hand.
 *
 *   const b = new LevelBuilder(16);           // 16 rows tall
 *   b.ground(6, 3).start(2).gems(3, 4)        // 6 columns of ground 3 high, the start, 4 gems
 *    .pit(3).ground(8).foe(4, "e").slope(2)   // a 3-wide gap, more ground with a walker, a 2-high slope up
 *    .ground(10).goal(6);
 *   const def = b.level({ id: "1-1", name: "Rooftop Run", time: 180 });
 *
 * Heights are tile rows: ground(len, h) fills rows 0..h-1, so heroes stand at y = h. Placement helpers take
 * dx relative to the start of the last segment (or absolute columns with `at`) and dy relative to the ground.
 */
import type { LevelDef } from "./level";

export class LevelBuilder {
  private cols: string[][] = [];
  /** Ground height per column (heroes stand at this y), -1 over pits. */
  readonly tops: number[] = [];
  /** Column where the last segment began. */
  seg = 0;
  h = 3;

  constructor(readonly height: number) {}

  get x() {
    return this.cols.length;
  }

  private col(fill: (r: number) => string, top: number) {
    const c = Array.from({ length: this.height }, (_, r) => fill(r));
    this.cols.push(c);
    this.tops.push(top);
  }

  /** Flat ground `len` wide at height `h` (default: the current height). */
  ground(len: number, h = this.h) {
    this.seg = this.x;
    this.h = h;
    for (let i = 0; i < len; i++) this.col((r) => (r < h ? "#" : " "), h);
    return this;
  }

  /** A gap: nothing to stand on (falling in costs a life, or a bubble in co-op). */
  pit(len: number) {
    this.seg = this.x;
    for (let i = 0; i < len; i++) this.col(() => " ", -1);
    return this;
  }

  /** Water `len` wide whose surface is `depth` rows below the current ground. */
  water(len: number, depth = 1) {
    this.seg = this.x;
    const s = Math.max(1, this.h - depth);
    for (let i = 0; i < len; i++) this.col((r) => (r < s ? "~" : " "), -1);
    return this;
  }

  /** A 45° slope climbing (dh > 0) or descending (dh < 0) |dh| rows. */
  slope(dh: number) {
    this.seg = this.x;
    const up = dh > 0;
    for (let i = 0; i < Math.abs(dh); i++) {
      if (up) {
        const base = this.h + i;
        this.col((r) => (r < base ? "#" : r === base ? "/" : " "), base + 1);
      } else {
        const base = this.h - i - 1;
        this.col((r) => (r < base ? "#" : r === base ? "\\" : " "), base + 1);
      }
    }
    this.h += dh;
    return this;
  }

  /** Spikes on the ground for `len` columns (jump them!). */
  spikes(len: number, h = this.h) {
    this.seg = this.x;
    this.h = h;
    for (let i = 0; i < len; i++) this.col((r) => (r < h ? "#" : r === h ? "^" : " "), h);
    return this;
  }

  /** Puts glyph `ch` at column seg + dx, `dy` rows above the ground there (or absolute row `y` with at()). */
  on(dx: number, ch: string, dy = 0) {
    const c = this.seg + dx;
    const top = this.tops[c] ?? this.h;
    return this.at(c, (top < 0 ? this.h : top) + dy, ch);
  }

  at(c: number, y: number, ch: string) {
    while (this.cols.length <= c) this.col(() => " ", -1);
    if (y >= 0 && y < this.height) this.cols[c]![y] = ch;
    return this;
  }

  /** `n` gems in a row starting at dx, dy above the ground (dy default 1: chest height). */
  gems(dx: number, n: number, dy = 1, step = 1) {
    for (let i = 0; i < n; i++) this.on(dx + i * step, "o", dy);
    return this;
  }

  /** An arc of gems over a gap or along a jump: n gems from dx, peaking `rise` above the ground. */
  arc(dx: number, n: number, rise = 3, base = 1) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const c = this.seg + dx + i;
      const top = this.tops[this.seg + dx] ?? this.h;
      this.at(c, (top < 0 ? this.h : top) + base + Math.round(rise * Math.sin(Math.PI * t)), "o");
    }
    return this;
  }

  /** A one-way platform `len` wide at absolute height y (heroes stand at y + 1). */
  shelf(c: number, y: number, len: number, ch = "=") {
    for (let i = 0; i < len; i++) this.at(c + i, y, ch);
    return this;
  }

  /** A bridge `len` wide over nothing at the current height: one-way planks (=), crumbling floor (Y) or blocks (B). */
  bridge(len: number, ch = "=") {
    this.seg = this.x;
    const y = this.h - 1;
    for (let i = 0; i < len; i++) this.col((r) => (r === y ? ch : " "), this.h);
    return this;
  }

  /** A ladder (or vine/rope) at column seg + dx from row y0 up to row y1 (inclusive). */
  ladder(dx: number, y0: number, y1: number) {
    for (let y = y0; y <= y1; y++) this.at(this.seg + dx, y, "H");
    return this;
  }

  /** A column of `ch` at seg + dx from the ground up `n` rows (walls, gates D/E, blocks). */
  pillar(dx: number, n: number, ch = "#", dy = 0) {
    for (let i = 0; i < n; i++) this.on(dx, ch, dy + i);
    return this;
  }

  start(dx = 1) { return this.on(dx, "P"); }
  goal(dx: number) { return this.on(dx, "G"); }
  checkpoint(dx: number) { return this.on(dx, "C"); }
  foe(dx: number, kind: "e" | "h" | "f" | "k", dy = 0) { return this.on(dx, kind, kind === "f" ? dy + 1 : dy); }
  spring(dx: number) { return this.on(dx, "S"); }
  boost(dx: number) { return this.on(dx, ">"); }
  power(dx: number, dy = 1) { return this.on(dx, "U", dy); }
  loop(dx: number) { return this.on(dx, "Q"); }

  /** The finished level (rows top to bottom). */
  level(meta: Omit<LevelDef, "rows">): LevelDef {
    const rows: string[] = [];
    for (let r = this.height - 1; r >= 0; r--) rows.push(this.cols.map((c) => c[r]!).join(""));
    return { ...meta, rows };
  }
}
