/**
 * Carry Me Home: two players carry one sofa. Each phone steers one end (stick, tilt or finger); the sofa is
 * rigid, so walking together moves it at full speed, one person alone can only drag it at half speed, and
 * turning a corner means one of you pivots while the other walks round. Scrape the walls and it costs a
 * star; get hit by a car and it costs a life. Bring the middle of the sofa onto the new home to win.
 */
import type { Draw } from "../kitgrid/draw";
import { rng } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import { COLS, ROWS, type CarryLevel } from "./levels";

export interface P { x: number; y: number }

const SPEED = 4.2; // cells per second at full stick
const PUDDLE = 0.45;
const DEAD = 0.12;
const RADIUS = 0.32; // half the sofa's width, for collisions
const GATE_PERIOD = 4200;
const GATE_OPEN = 2400;
const CAR_LEN = 1.7;
const LIVES = 3;
const SKINS: Record<string, [string, string]> = {
  "": ["#3d7bd9", "#6ea2f0"],
  "sofa-velvet": ["#7b3fb8", "#a774db"],
  "sofa-lemon": ["#e0b21b", "#f5d55e"],
  "sofa-leather": ["#7a4a26", "#a8703f"],
};

export interface Parsed { cells: string[]; a: P; b: P; home: P; hearts: P[]; lanes: number[] }

export function parse(level: CarryLevel): Parsed {
  const cells = level.map;
  let a: P = { x: 0, y: 0 }, b: P = { x: 0, y: 0 };
  const hearts: P[] = [], homes: P[] = [], lanes: number[] = [];
  cells.forEach((row, y) => {
    if (row.includes("=")) lanes.push(y);
    [...row].forEach((ch, x) => {
      const c = { x: x + 0.5, y: y + 0.5 };
      if (ch === "A") a = c;
      else if (ch === "B") b = c;
      else if (ch === "h") hearts.push(c);
      else if (ch === "D") homes.push(c);
    });
  });
  const home = { x: homes.reduce((s, p) => s + p.x, 0) / homes.length, y: homes.reduce((s, p) => s + p.y, 0) / homes.length };
  return { cells, a, b, home, hearts, lanes };
}

const cellAt = (cells: string[], x: number, y: number) =>
  x < 0 || y < 0 || x >= COLS || y >= ROWS ? "#" : cells[Math.floor(y)]![Math.floor(x)]!;

/** Points along the sofa, every quarter cell. */
export function samples(a: P, b: P): P[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(len / 0.25));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Does a sofa from a to b fit (no wall, no closed gate under any part of it)? */
export function fits(cells: string[], a: P, b: P, gatesOpen: boolean): boolean {
  for (const s of samples(a, b)) {
    for (const [dx, dy] of [[0, 0], [-RADIUS, -RADIUS], [RADIUS, -RADIUS], [-RADIUS, RADIUS], [RADIUS, RADIUS]] as const) {
      const ch = cellAt(cells, s.x + dx, s.y + dy);
      if (ch === "#" || (ch === "g" && !gatesOpen)) return false;
    }
  }
  return true;
}

interface Car { x: number; lane: number; dir: 1 | -1; color: string }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; text?: string }
/** Seconds of walking in step before the teamwork bonus starts paying. */
const SYNC_AFTER = 0.6;
const SYNC_BOOST = 1.2;
const CAR_COLORS = ["#e94f4f", "#f2a93b", "#4fc3e9", "#8be04f", "#d24fe9", "#f5f5f5"];

export class CarrySim implements Sim {
  readonly cols = COLS;
  readonly rows = ROWS;
  private p: Parsed;
  private ends: [P, P];
  private len: number;
  private input: [P, P] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  private solo: boolean;
  private ms = 0;
  private scrapes = 0;
  private scrapeCd = 0;
  private lives = LIVES;
  private hurt = 0; // invulnerable ms after a car
  private got = new Set<number>();
  private cars: Car[] = [];
  private gatesOpen = true;
  private result: Outcome | null = null;
  private startDist: number;
  private sofa: [string, string];
  private colors: string[];
  private pushing = [0, 0]; // smoothed stick lengths, for the carriers' walk animation
  private bits: Bit[] = [];
  private r: () => number;
  /** Seconds the two of you have been walking the same way. */
  private sync = 0;
  private syncPoints = 0;
  private bestSync = 0;
  private dust = 0;

  constructor(private level: CarryLevel, seed: number, skin: string, colors: string[], private quick = false) {
    this.p = parse(level);
    this.ends = [{ ...this.p.a }, { ...this.p.b }];
    this.len = Math.hypot(this.p.b.x - this.p.a.x, this.p.b.y - this.p.a.y);
    this.solo = colors.length < 2;
    this.colors = [colors[0] ?? "#ff8a8a", colors[1] ?? "#8ab4ff"];
    this.sofa = SKINS[skin] ?? SKINS[""]!;
    this.startDist = Math.hypot(this.mid().x - this.p.home.x, this.mid().y - this.p.home.y);
    const r = rng(seed);
    this.r = rng(seed ^ 0x5bd1);
    this.p.lanes.forEach((lane, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      for (let x = r() * 6; x < COLS + 4; x += 7 + r() * 4) this.cars.push({ x, lane, dir, color: CAR_COLORS[Math.floor(r() * CAR_COLORS.length)]! });
    });
  }

  private mid(): P {
    return { x: (this.ends[0].x + this.ends[1].x) / 2, y: (this.ends[0].y + this.ends[1].y) / 2 };
  }

  steer(player: number, x: number, y: number) {
    if (player > 1) return;
    const m = Math.hypot(x, y);
    this.input[player] = m < DEAD ? { x: 0, y: 0 } : { x: x / Math.max(1, m), y: -y / Math.max(1, m) }; // y up → screen down
  }

  act(): SimEvent[] {
    return [];
  }

  step(ms: number): SimEvent[] {
    if (this.result) return [];
    const ev: SimEvent[] = [];
    for (let left = ms; left > 0; left -= 16) ev.push(...this.tick(Math.min(16, left)));
    return ev;
  }

  private tick(ms: number): SimEvent[] {
    const ev: SimEvent[] = [];
    const dt = ms / 1000;
    this.ms += ms;
    this.scrapeCd = Math.max(0, this.scrapeCd - ms);
    this.hurt = Math.max(0, this.hurt - ms);

    // gates swing on a beat, but never shut on the sofa
    const wantOpen = (this.ms % GATE_PERIOD) < GATE_OPEN;
    if (wantOpen !== this.gatesOpen) {
      if (wantOpen || fits(this.p.cells, this.ends[0], this.ends[1], false)) {
        this.gatesOpen = wantOpen;
        if (this.p.cells.some((r) => r.includes("g"))) ev.push({ sfx: wantOpen ? "unflag" : "lock" });
      }
    }

    // move: each end by its player's stick, then hold the sofa's length
    const [a, b] = this.ends;
    const vel = this.input.map((v, i) => {
      const e = this.ends[i]!;
      const k = cellAt(this.p.cells, e.x, e.y) === "~" ? PUDDLE : 1;
      return { x: v.x * SPEED * k * dt, y: v.y * SPEED * k * dt };
    });
    if (this.solo) vel[1] = { x: 0, y: 0 };
    // teamwork: both sticks pushing the same way, hard enough, builds a streak that speeds you up and scores
    const [ia, ib] = this.input;
    const inStep = !this.solo && Math.hypot(ia.x, ia.y) > 0.5 && Math.hypot(ib.x, ib.y) > 0.5 && ia.x * ib.x + ia.y * ib.y > 0.8 * Math.hypot(ia.x, ia.y) * Math.hypot(ib.x, ib.y);
    if (inStep) {
      const before = this.sync;
      this.sync += dt;
      if (this.sync > SYNC_AFTER) {
        for (const v of vel) { v.x *= SYNC_BOOST; v.y *= SYNC_BOOST; }
        this.syncPoints += dt * 20;
      }
      if (before < SYNC_AFTER && this.sync >= SYNC_AFTER) ev.push({ sfx: "turn" });
      if (Math.floor(before / 3) < Math.floor(this.sync / 3)) {
        const m = this.mid();
        this.pop(m.x, m.y - 0.8, `In step ×${Math.floor(this.sync / 3)}!`, "#ffe36b");
        ev.push({ sfx: "bonus", buzz: 25 });
      }
      this.bestSync = Math.max(this.bestSync, this.sync);
    } else this.sync = Math.max(0, this.sync - dt * 3);
    this.pushing = this.pushing.map((s, i) => s * 0.85 + Math.hypot(vel[i]!.x, vel[i]!.y) / dt / SPEED * 0.15);
    const solve = (na: P, nb: P): [P, P] => {
      const dx = nb.x - na.x, dy = nb.y - na.y;
      const d = Math.hypot(dx, dy) || 1;
      const c = d - this.len, ux = dx / d, uy = dy / d;
      // together the correction is shared; alone the other end is towed like a trailer
      const sa = this.solo ? 0 : 0.5, sb = 1 - sa;
      return [{ x: na.x + ux * c * sa, y: na.y + uy * c * sa }, { x: nb.x - ux * c * sb, y: nb.y - uy * c * sb }];
    };
    const tries: Array<[P, P]> = [
      solve({ x: a.x + vel[0]!.x, y: a.y + vel[0]!.y }, { x: b.x + vel[1]!.x, y: b.y + vel[1]!.y }),
      solve({ x: a.x + vel[0]!.x, y: a.y }, { x: b.x + vel[1]!.x, y: b.y }), // slide along a wall
      solve({ x: a.x, y: a.y + vel[0]!.y }, { x: b.x, y: b.y + vel[1]!.y }),
    ];
    const moving = Math.hypot(vel[0]!.x, vel[0]!.y) + Math.hypot(vel[1]!.x, vel[1]!.y) > 0;
    if (moving) {
      const ok = tries.findIndex(([na, nb]) => fits(this.p.cells, na, nb, this.gatesOpen));
      if (ok >= 0) this.ends = tries[ok]!;
      if (ok !== 0 && this.scrapeCd === 0) {
        this.scrapes++;
        this.scrapeCd = 700;
        this.sync = 0;
        const hit = [...this.ends].sort((p, q) => this.wallNear(p) - this.wallNear(q))[0]!;
        this.burst(hit.x, hit.y, 10, ["#ffd36b", "#ff9a3c", "#fff"], 4, 0.07);
        ev.push({ sfx: "dig", shake: 0.12, buzz: 40, toast: this.scrapes === this.level.scrapes + 1 ? "Careful! Too many scrapes for ★★" : undefined, tone: "bad" });
      }
    }

    if (moving) {
      this.dust += dt;
      if (this.dust > 0.12) {
        this.dust = 0;
        this.ends.forEach((e, i) => {
          if (Math.hypot(vel[i]!.x, vel[i]!.y) > 0) this.bits.push({ x: e.x + (this.r() - 0.5) * 0.3, y: e.y + 0.3, vx: (this.r() - 0.5) * 0.4, vy: -0.2, life: 0.5, max: 0.5, color: "rgba(140, 110, 80, 0.35)", size: 0.12 });
        });
      }
    }
    this.stepBits(dt);

    // cars
    const pts = samples(this.ends[0], this.ends[1]);
    const speed = this.level.cars ?? 0;
    for (const c of this.cars) {
      c.x += c.dir * speed * dt;
      if (c.dir > 0 && c.x > COLS + 2) c.x -= COLS + 4;
      if (c.dir < 0 && c.x < -2) c.x += COLS + 4;
      if (this.hurt > 0) continue;
      const hit = pts.some((s) => Math.abs(s.y - (c.lane + 0.5)) < 0.42 + RADIUS && s.x > c.x - CAR_LEN / 2 - RADIUS && s.x < c.x + CAR_LEN / 2 + RADIUS);
      if (hit) {
        this.lives--;
        this.hurt = 1800;
        ev.push({ sfx: "hit", shake: 0.45, buzz: 220 });
        const m = this.mid();
        this.burst(m.x, m.y, 18, ["#ffffff", "#ffd36b", c.color], 5, 0.1);
        this.pop(m.x, m.y - 0.8, "HONK!", "#ff6b6b");
        this.sync = 0;
        if (this.lives <= 0) {
          this.finish(false);
          ev.push({ toast: "The sofa went back to the van. Try again!", tone: "bad" });
          return ev;
        }
        ev.push({ toast: `Honk! ${this.lives} ${this.lives === 1 ? "life" : "lives"} left. Back to the start`, tone: "bad" });
        this.ends = [{ ...this.p.a }, { ...this.p.b }];
        return ev;
      }
    }

    // hearts
    this.p.hearts.forEach((h, i) => {
      if (this.got.has(i)) return;
      if (pts.some((s) => Math.abs(s.x - h.x) < 0.6 && Math.abs(s.y - h.y) < 0.6)) {
        this.got.add(i);
        ev.push({ sfx: "eat", toast: "💗 Heart!", tone: "good" });
        this.burst(h.x, h.y, 14, ["#ff5c9a", "#ffb3d0", "#ffffff"], 3.5, 0.09);
        this.pop(h.x, h.y - 0.6, "+150", "#ff8ab8");
      }
    });

    // home
    const m = this.mid();
    if (cellAt(this.p.cells, m.x, m.y) === "D") {
      this.finish(true);
      ev.push({ sfx: "clear" });
      for (let k = 0; k < 4; k++) this.burst(m.x + (this.r() - 0.5) * 3, m.y + (this.r() - 0.5) * 2, 16, ["#ff5c9a", "#ffe36b", "#6bd6ff", "#9cff6b"], 5, 0.11);
      this.pop(m.x, m.y - 1, "HOME! 🏠", "#ffffff");
    }
    return ev;
  }

  private wallNear(p: P) {
    let best = 9;
    for (const [dx, dy] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) if (cellAt(this.p.cells, p.x + dx, p.y + dy) === "#") best = Math.min(best, Math.hypot(dx, dy));
    return best;
  }

  private burst(x: number, y: number, n: number, colors: string[], speed: number, size: number) {
    for (let i = 0; i < n && this.bits.length < 160; i++) {
      const a = this.r() * Math.PI * 2, v = speed * (0.4 + this.r() * 0.6);
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7, max: 0.7, color: colors[i % colors.length]!, size: size * (0.6 + this.r() * 0.8) });
    }
  }

  private pop(x: number, y: number, text: string, color: string) {
    this.bits.push({ x, y, vx: 0, vy: -1.2, life: 1.1, max: 1.1, color, size: 0.55, text });
  }

  private stepBits(dt: number) {
    for (const b of this.bits) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.9;
      b.vy = b.text ? b.vy * 0.95 : b.vy * 0.9;
      b.life -= dt;
    }
    if (this.bits.some((b) => b.life <= 0)) this.bits = this.bits.filter((b) => b.life > 0);
  }

  private seconds() {
    return this.ms / 1000;
  }

  private score(won: boolean) {
    const hearts = this.got.size * 150 + Math.round(this.syncPoints);
    if (!won) return hearts;
    return Math.max(100, 1000 + hearts + Math.max(0, Math.round((this.level.par - this.seconds()) * 10)) - this.scrapes * 25);
  }

  private finish(won: boolean) {
    const clean = this.scrapes <= this.level.scrapes;
    const fast = this.seconds() <= this.level.par || this.quick;
    this.result = {
      won,
      stars: (won ? 1 + (clean ? 1 : 0) + (fast ? 1 : 0) : 0) as Outcome["stars"],
      score: this.score(won),
      checks: [
        { text: `Sofa delivered home${this.bestSync >= 3 ? ` · in step for ${Math.floor(this.bestSync)} s` : ""}`, ok: won },
        { text: `At most ${this.level.scrapes} wall scrapes (${this.scrapes})`, ok: won && clean },
        { text: `Home within ${this.level.par} s (${Math.round(this.seconds())} s)`, ok: won && fast },
      ],
    };
  }

  outcome() {
    return this.result;
  }

  hud(): Hud {
    const m = this.mid();
    const d = Math.hypot(m.x - this.p.home.x, m.y - this.p.home.y);
    return {
      score: this.score(false),
      goal: `💗 ${this.got.size} / ${this.p.hearts.length} · scrapes ${this.scrapes}`,
      progress: Math.max(0, Math.min(1, 1 - d / this.startDist)),
      lives: this.lives,
      seconds: this.seconds(),
    };
  }

  debug() {
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      ends: this.ends.map((e) => ({ x: r(e.x), y: r(e.y) })), mid: { x: r(this.mid().x), y: r(this.mid().y) },
      home: this.p.home, scrapes: this.scrapes, lives: this.lives, hearts: this.got.size, gatesOpen: this.gatesOpen, sync: r(this.sync),
    };
  }

  // ---- drawing ----

  draw(d: Draw) {
    const cells = this.p.cells;
    d.layer(`carry-${this.level.name}`, COLS, ROWS, (L) => {
      cells.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === "#") {
          L.rect(x, y, 1, 1, "#3b2f4a");
          L.rect(x, y, 1, 0.18, "#55466a");
          return;
        }
        L.rect(x, y, 1, 1, (x + y) % 2 ? "#e9d6b8" : "#e2cdab"); // wooden floor
        if (ch === "=") {
          L.rect(x, y, 1, 1, "#3a3d46");
          const lane = this.p.lanes.indexOf(y);
          if (lane % 2 === 0 && this.p.lanes.includes(y + 1)) L.rect(x + 0.15, y + 0.95, 0.5, 0.1, "#f2d25c");
        } else if (ch === "~") L.rect(x + 0.05, y + 0.05, 0.9, 0.9, "#7fb7e6", 0.35);
        else if (ch === "D") L.rect(x, y, 1, 1, "#ffcf8a");
      }));
      // decor (same every time for a level): rugs on open floor, plants in corners, pictures on the walls
      const dr = rng(this.level.name.length * 977 + this.level.world);
      const open = (x: number, y: number) => { const c = cellAt(cells, x, y); return c === "." || c === "h"; };
      for (let k = 0; k < 40; k++) {
        const x = 1 + Math.floor(dr() * (COLS - 3)), y = 1 + Math.floor(dr() * (ROWS - 3));
        const kind = dr();
        if (kind < 0.15 && open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x + 1, y + 1)) {
          const rug = ["201, 106, 106", "106, 143, 201", "138, 201, 106", "201, 164, 106"][Math.floor(dr() * 4)]!;
          L.rect(x + 0.1, y + 0.1, 1.8, 1.8, `rgba(${rug}, 0.28)`, 0.6);
          L.stroke(x + 0.3, y + 0.3, 1.4, 1.4, `rgba(${rug}, 0.5)`, 0.05, 0.45);
          L.circle(x + 1, y + 1, 0.3, `rgba(${rug}, 0.35)`);
        } else if (kind < 0.35 && cellAt(cells, x, y) === "#" && open(x, y + 1)) {
          L.rect(x + 0.25, y + 0.3, 0.5, 0.42, "#f4e3c0", 0.04);
          L.rect(x + 0.32, y + 0.36, 0.36, 0.3, ["#7fb7e6", "#e6a07f", "#a3e67f"][Math.floor(dr() * 3)]!);
        } else if (kind < 0.45 && open(x, y) && (cellAt(cells, x - 1, y) === "#" || cellAt(cells, x + 1, y) === "#") && (cellAt(cells, x, y - 1) === "#" || cellAt(cells, x, y + 1) === "#")) {
          L.circle(x + 0.5, y + 0.62, 0.22, "#a0613a");
          L.circle(x + 0.5, y + 0.4, 0.3, "#4f9a52");
          L.circle(x + 0.38, y + 0.3, 0.16, "#62b565");
        }
      }
      // the home: a door mat and a roof
      const h = this.p.home;
      L.stroke(h.x - 1.5, h.y - 1, 3, 2, "#c46a2b", 0.12, 0.2);
      L.text("🏠", h.x, h.y, 1.1, "#000");
    });

    // gates
    const gateCol = this.gatesOpen ? "rgba(120, 80, 40, 0.25)" : "#8a5a2b";
    cells.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== "g") return;
      if (this.gatesOpen) d.stroke(x + 0.1, y + 0.1, 0.8, 0.8, gateCol, 0.06, 0.1);
      else for (let i = 0; i < 3; i++) d.rect(x + 0.12 + i * 0.3, y + 0.05, 0.16, 0.9, gateCol, 0.05);
    }));

    // hearts
    this.p.hearts.forEach((h, i) => {
      if (!this.got.has(i)) d.text("💗", h.x, h.y + Math.sin(d.t * 4 + i) * 0.08, 0.7 + Math.sin(d.t * 6 + i) * 0.05, "#e9407a");
    });

    // cars
    for (const c of this.cars) {
      const y = c.lane + 0.5;
      d.rect(c.x - CAR_LEN / 2, y - 0.38, CAR_LEN, 0.76, c.color, 0.22);
      d.rect(c.x - 0.35, y - 0.3, 0.7, 0.6, "rgba(20, 30, 50, 0.55)", 0.12);
      const front = c.x + (c.dir * CAR_LEN) / 2 - c.dir * 0.08;
      d.circle(front, y - 0.22, 0.08, "#fff7c2");
      d.circle(front, y + 0.22, 0.08, "#fff7c2");
    }

    // the sofa, then its two carriers
    const [a, b] = this.ends;
    const ctx = d.ctx;
    const blink = this.hurt > 0 && Math.floor(this.hurt / 120) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.25;
    const m = this.mid();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const L = this.len + 0.5;
    ctx.save();
    ctx.translate(d.ox + m.x * d.cell, d.oy + m.y * d.cell);
    ctx.rotate(ang);
    const C = d.cell;
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.beginPath();
    ctx.roundRect((-L / 2 + 0.06) * C, (-0.42 + 0.1) * C, L * C, 0.84 * C, 0.2 * C);
    ctx.fill();
    if (this.sync > SYNC_AFTER) {
      const glow = Math.min(1, (this.sync - SYNC_AFTER) / 1.5) * (0.6 + Math.sin(d.t * 10) * 0.25);
      ctx.fillStyle = `rgba(255, 227, 107, ${0.45 * glow})`;
      ctx.beginPath();
      ctx.roundRect((-L / 2 - 0.2) * C, -0.62 * C, (L + 0.4) * C, 1.24 * C, 0.4 * C);
      ctx.fill();
    }
    ctx.fillStyle = this.sofa[0];
    ctx.beginPath();
    ctx.roundRect((-L / 2) * C, -0.42 * C, L * C, 0.84 * C, 0.2 * C);
    ctx.fill();
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)"; // backrest
    ctx.fillRect((-L / 2 + 0.1) * C, -0.42 * C, (L - 0.2) * C, 0.16 * C);
    ctx.fillStyle = this.sofa[1];
    const n = Math.max(2, Math.round(this.len));
    const cw = (L - 0.6) / n;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.roundRect((-L / 2 + 0.3 + i * cw + 0.04) * C, -0.18 * C, (cw - 0.08) * C, 0.48 * C, 0.1 * C);
      ctx.fill();
    }
    ctx.restore();
    // the carriers: a little person at each end, bobbing as they walk
    this.ends.forEach((e, i) => {
      if (this.solo && i === 1) return;
      const walk = Math.min(1, this.pushing[i]! * 2);
      const bob = Math.abs(Math.sin(d.t * 12 + i * Math.PI)) * 0.08 * walk;
      const out = i === 0 ? -1 : 1; // stand just beyond the sofa's end
      const px = e.x + Math.cos(ang) * 0.42 * out, py = e.y + Math.sin(ang) * 0.42 * out - bob;
      d.circle(px, e.y + Math.sin(ang) * 0.42 * out + 0.42, 0.34, "rgba(0, 0, 0, 0.2)");
      d.circle(px, py + 0.08, 0.42, "#ffffff");
      d.circle(px, py + 0.08, 0.38, this.colors[i]!); // body
      d.circle(px, py - 0.34, 0.27, "#ffd9b8"); // head
      d.rect(px - 0.27, py - 0.56, 0.54, 0.13, this.colors[i]!, 0.06); // hair band in the player's colour
      d.circle(px - 0.09, py - 0.34, 0.04, "#2a1c33");
      d.circle(px + 0.09, py - 0.34, 0.04, "#2a1c33");
      d.rect(px - 0.08, py - 0.24, 0.16, 0.04, "#c0605a", 0.02); // smile
      if (this.sync > SYNC_AFTER) d.text("♪", px + 0.42, py - 0.7 - bob, 0.38, "#ffe36b");
      d.text(i === 0 ? "1" : "2", px, py + 0.12, 0.36, "#ffffff");
    });
    ctx.globalAlpha = 1;
    // sparks, dust, hearts and score pop-ups
    for (const b of this.bits) {
      const a = Math.max(0, b.life / b.max);
      ctx.globalAlpha = a;
      if (b.text) d.text(b.text, b.x, b.y, b.size, b.color, 900);
      else d.circle(b.x, b.y, b.size * (b.text ? 1 : 0.5 + a * 0.5), b.color);
    }
    ctx.globalAlpha = 1;
  }
}
