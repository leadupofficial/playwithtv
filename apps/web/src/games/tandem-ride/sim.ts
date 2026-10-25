/**
 * Tandem Ride: a two-seater bike that only flies when you ride it together. Each phone pedals by rocking
 * (tilt, joystick or finger) side to side: every swing is a pedal stroke. Strokes close together are "in
 * step" and push harder. Jump on your own and you hop over rocks; press Jump together (within a moment of
 * each other) for a big jump over logs and up to the high flowers. Race Grandpa Joe's ghost bike to the
 * picnic. Alone, you pedal at half power and every jump is a big one.
 */
import type { Draw } from "../kitgrid/draw";
import { rng } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import type { TandemLevel } from "./levels";

export const COLS = 24;
export const ROWS = 14;
/** Height gained per uphill metre. */
export const RISE = 0.35;
const ROCK_AT = 0.45; // stick swing past this is a stroke
const STROKE = 0.95; // speed added per stroke
const SOLO_STROKE = 0.75;
const IN_STEP = 0.14; // seconds: strokes this close together are in step
const STEP_BONUS = 1.45;
const DRAG = 0.55;
const ROLL = 0.35; // rolling resistance, cells/s²
const SLOPE = 4.2; // how hard hills pull, cells/s² per unit of gradient
const MAX_V = 10; // only while you pedal in step
const MAX_APART = 7.5; // out of step (or alone) the bike tops out here
const GRAVITY = 20;
const HOP = 4.6;
const BIG = 7.6;
const TOGETHER = 0.35; // seconds between the two Jump presses for a big jump
const LOG_H = 0.85;
const ROCK_H = 0.35;
const HIGH = 1.15; // how high the high flowers float
const CRASH_MS = 1300;
const BIKE_X = 7; // where the bike sits on screen

interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; text?: string }

/** Ground height at every metre (index = metre), from the track text. */
export function heights(track: string): number[] {
  const h: number[] = [];
  let y = 0;
  for (const ch of track) {
    if (ch === "/") y += RISE;
    h.push(y);
    if (ch === "\\") y -= RISE;
  }
  for (let i = 0; i < track.length; i++) if (track[i] === "\\") h[i] = h[i]! - RISE; // a downhill metre ends lower
  return h;
}

export class TandemSim implements Sim {
  readonly cols = COLS;
  readonly rows = ROWS;
  private h: number[];
  private track: string;
  private len: number;
  private x = 2;
  private v = 0;
  private air = 0; // height above the ground
  private vy = 0;
  private ms = 0;
  private side: number[];
  private lastStroke: number[];
  private strokes: number[];
  private stepStreak = 0;
  private bestStreak = 0;
  private inStep = 0; // glow timer
  private jumpAt = -9;
  private jumper = -1;
  private big = false;
  private crashes = 0;
  private crash = 0;
  private flowers = new Set<number>();
  private splashed = new Set<number>();
  private hitLogs = new Set<number>();
  private totalFlowers: number;
  private crank = 0;
  private bits: Bit[] = [];
  private r: () => number;
  private result: Outcome | null = null;
  private solo: boolean;
  private colors: string[];
  private camY = 0;

  constructor(private level: TandemLevel, seed: number, private skin: string, colors: string[], private quick = false, private theme = "") {
    this.track = quick ? level.track.slice(0, 60).replace(/F/g, ".") + "....F" : level.track;
    this.len = this.track.length - 1;
    this.h = heights(this.track);
    this.r = rng(seed);
    this.solo = colors.length < 2;
    this.colors = [colors[0] ?? "#ff8a8a", colors[1] ?? "#8ab4ff"];
    this.side = [0, 0];
    this.lastStroke = [-9, -9];
    this.strokes = [0, 0];
    this.totalFlowers = [...this.track].filter((c) => c === "f" || c === "*").length;
    this.camY = this.ground(this.x);
  }

  private par() {
    return this.quick ? Math.round((this.level.par * 64) / this.level.track.length) : this.level.par;
  }

  /** Ground height at a position (interpolated). */
  ground(x: number): number {
    const i = Math.max(0, Math.min(this.h.length - 1, Math.floor(x)));
    const f = x - Math.floor(x);
    const ch = this.track[i];
    const base = this.h[i]!;
    if (ch === "/") return base - RISE + RISE * f;
    if (ch === "\\") return base + RISE - RISE * f;
    return base;
  }
  private slope(x: number) {
    const ch = this.track[Math.floor(x)];
    return ch === "/" ? RISE : ch === "\\" ? -RISE : 0;
  }

  steer(player: number, x: number, _y = 0) {
    if (player > 1 || (this.solo && player > 0) || this.result || this.crash > 0) return;
    const s = x > ROCK_AT ? 1 : x < -ROCK_AT ? -1 : 0;
    if (s !== 0 && s !== this.side[player]) {
      this.side[player] = s;
      this.stroke(player);
    }
  }

  private cap() {
    return !this.solo && this.inStep > 0 ? MAX_V : MAX_APART;
  }

  private pendingEv: SimEvent[] = [];
  private stroke(p: number) {
    const t = this.ms / 1000;
    const other = 1 - p;
    let gain = this.solo ? SOLO_STROKE : STROKE;
    if (!this.solo && Math.abs(t - this.lastStroke[other]!) < IN_STEP && this.lastStroke[other]! > this.lastStroke[p]!) {
      gain *= STEP_BONUS;
      this.stepStreak++;
      this.inStep = 0.6;
      if (this.stepStreak % 8 === 0) {
        this.pop(this.x, this.ground(this.x) + 2.4, `In step ×${this.stepStreak / 8}!`, "#d6246e");
        this.pendingEv.push({ sfx: "bonus", buzz: 25 });
      }
      this.bestStreak = Math.max(this.bestStreak, this.stepStreak);
    } else if (!this.solo && t - this.lastStroke[other]! > 1.2) this.stepStreak = 0;
    this.lastStroke[p] = t;
    this.strokes[p]!++;
    if (this.air <= 0) this.v = Math.min(this.cap(), this.v + gain);
  }

  act(action: string, player = 0): SimEvent[] {
    if (this.result || action !== "jump" || this.crash > 0) return [];
    const t = this.ms / 1000;
    if (this.air <= 0) {
      this.vy = this.solo ? BIG : HOP;
      this.big = this.solo;
      this.air = 0.001;
      this.jumpAt = t;
      this.jumper = player;
      return [{ sfx: this.solo ? "warp" : "move" }];
    }
    if (!this.big && player !== this.jumper && t - this.jumpAt < TOGETHER) {
      this.vy += BIG - HOP;
      this.big = true;
      this.pop(this.x, this.ground(this.x) + this.air + 2, "Together! ⬆", "#0f7a52");
      this.burst(this.x, this.ground(this.x) + 0.3, 10, ["#ffffff", "#7cf2c2"], 3, 0.08);
      return [{ sfx: "warp", buzz: 40 }];
    }
    return [];
  }

  step(ms: number): SimEvent[] {
    if (this.result) return [];
    const ev: SimEvent[] = [];
    for (let left = ms; left > 0 && !this.result; left -= 16) ev.push(...this.tick(Math.min(16, left)));
    return ev;
  }

  private tick(ms: number): SimEvent[] {
    const ev: SimEvent[] = this.pendingEv;
    this.pendingEv = [];
    const dt = ms / 1000;
    this.ms += ms;
    this.inStep = Math.max(0, this.inStep - dt);

    if (this.crash > 0) {
      this.crash -= ms;
      this.v = 0;
    } else {
      const grounded = this.air <= 0;
      if (grounded) {
        this.v -= (this.v * DRAG + (this.v > 0 ? ROLL : 0)) * dt;
        this.v -= this.slope(this.x) * SLOPE * dt;
        // you can't roll backwards down a hill: the brakes hold you
        this.v = Math.max(0, Math.min(Math.max(this.cap(), this.v - 3 * dt), this.v)); // over the cap you ease back down
      }
      const before = this.x;
      this.x = Math.min(this.len + 0.5, this.x + this.v * dt);
      this.crank += this.v * dt * 1.6;
      if (!grounded) {
        this.vy -= GRAVITY * dt;
        this.air += this.vy * dt;
        // the ground may rise under you
        if (this.air <= 0) {
          this.air = 0;
          this.vy = 0;
          this.big = false;
          this.burst(this.x, this.ground(this.x), 6, ["#d9c7a0", "#bfa77a"], 2, 0.07);
          ev.push({ sfx: "drop" });
        }
      }
      ev.push(...this.things(before, this.x));
    }

    if (this.v > 4 && this.air <= 0 && this.r() < this.v * dt) this.bits.push({ x: this.x - 1.2, y: this.ground(this.x) + 0.1, vx: -1, vy: 0.4, life: 0.4, max: 0.4, color: "rgba(190, 170, 130, 0.5)", size: 0.12 });
    if (this.x >= this.len) {
      this.finish();
      ev.push({ sfx: "clear" });
      for (let k = 0; k < 4; k++) this.burst(this.x + (this.r() - 0.5) * 3, this.ground(this.x) + 2 + this.r() * 2, 16, ["#ff5c9a", "#ffe36b", "#6bd6ff", "#9cff6b"], 5, 0.1);
      this.pop(this.x, this.ground(this.x) + 3.5, "Picnic time! 🧺", "#d6246e");
    }
    this.camY += (this.ground(this.x) - this.camY) * Math.min(1, dt * 3);
    this.stepBits(dt);
    return ev;
  }

  /** Logs, rocks, puddles and flowers passed between two positions (front wheel ≈ x + 0.9). */
  private things(from: number, to: number): SimEvent[] {
    const ev: SimEvent[] = [];
    for (let i = Math.floor(from + 0.9); i <= Math.floor(to + 0.9); i++) {
      const ch = this.track[i];
      const gy = this.ground(i + 0.5);
      // obstacles sit in the middle of their metre: you only hit one if the front wheel crosses that part
      const mid = from + 0.9 <= i + 0.75 && to + 0.9 >= i + 0.25;
      if ((ch === "L" || ch === "r") && mid && !this.hitLogs.has(i)) {
        const need = ch === "L" ? LOG_H : ROCK_H;
        if (this.air < need) {
          this.hitLogs.add(i);
          this.crashes++;
          this.crash = CRASH_MS;
          this.v = 0;
          this.air = 0;
          this.vy = 0;
          this.x = i - 1.2;
          this.stepStreak = 0;
          this.burst(i + 0.5, gy + 0.4, 14, ["#8a5a3a", "#c49a6c", "#ffffff"], 4, 0.1);
          this.pop(i, gy + 2.4, ch === "L" ? "Oof! Jump together!" : "Bump!", "#c0262b");
          ev.push({ sfx: "hit", shake: 0.35, buzz: 160, toast: ch === "L" ? "Logs need a big jump: press Jump at the same moment!" : "Hop over the rocks!", tone: "bad" });
          return ev;
        }
      }
      if (ch === "~" && this.air <= 0 && !this.splashed.has(i)) {
        this.splashed.add(i);
        this.v *= 0.72;
        this.burst(i + 0.5, gy + 0.1, 10, ["#7fc8ff", "#cdeaff"], 3.5, 0.09);
        ev.push({ sfx: "eat" });
      }
      if ((ch === "f" || ch === "*") && !this.flowers.has(i)) {
        const high = ch === "*";
        if ((high && this.air > HIGH - 0.45) || (!high && this.air < 0.9)) {
          this.flowers.add(i);
          this.burst(i + 0.5, gy + (high ? HIGH : 0.3) + 0.5, 10, ["#ffd23f", "#ff8ad1", "#ffffff"], 3, 0.08);
          this.pop(i + 0.5, gy + (high ? HIGH : 0.3) + 1.3, high ? "+50" : "+20", "#b35f00");
          ev.push({ sfx: high ? "bonus" : "eat" });
        }
      }
    }
    return ev;
  }

  private finish() {
    const secs = this.ms / 1000;
    const beatJoe = secs <= this.par();
    const most = this.flowers.size >= Math.ceil(this.totalFlowers * 0.6);
    const clean = this.crashes === 0;
    const stars = (1 + (beatJoe ? 1 : 0) + (beatJoe && most && clean ? 1 : 0)) as Outcome["stars"];
    this.result = {
      won: true,
      stars,
      score: this.points(),
      checks: [
        { text: `Picnic reached in ${secs.toFixed(1)} s${this.bestStreak >= 8 ? ` · ${this.bestStreak} strokes in step` : ""}`, ok: true },
        { text: `Beat Grandpa Joe (${this.par()} s)`, ok: beatJoe },
        { text: `No crashes and 🌼 ${this.flowers.size}/${this.totalFlowers} (need ${Math.ceil(this.totalFlowers * 0.6)})`, ok: most && clean },
      ],
    };
  }

  private points() {
    let p = 0;
    for (const i of this.flowers) p += this.track[i] === "*" ? 50 : 20;
    const secs = this.ms / 1000;
    return p + Math.max(0, Math.round((this.par() - secs) * 15)) + this.bestStreak * 2 + (this.result || this.x >= this.len ? 200 : 0);
  }

  outcome() {
    return this.result;
  }

  hud(): Hud {
    const secs = this.ms / 1000;
    const joe = (this.len * Math.min(secs, this.par())) / this.par();
    const gap = Math.round(this.x - joe);
    return {
      score: this.points(),
      goal: `🌼 ${this.flowers.size}/${this.totalFlowers} · ${gap >= 0 ? `ahead of Grandpa Joe by ${gap} m` : `Grandpa Joe is ${-gap} m ahead`}`,
      progress: Math.min(1, this.x / this.len),
      seconds: secs,
    };
  }

  debug() {
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      x: r(this.x), v: r(this.v), air: r(this.air), len: this.len, solo: this.solo, crashes: this.crashes, flowers: this.flowers.size,
      strokes: [...this.strokes], streak: this.stepStreak, big: this.big, joe: r((this.len * Math.min(this.ms / 1000, this.par())) / this.par()),
    };
  }

  // ---- effects ----
  private burst(x: number, y: number, n: number, colors: string[], speed: number, size: number) {
    for (let i = 0; i < n && this.bits.length < 160; i++) {
      const a = this.r() * Math.PI * 2, v = speed * (0.4 + this.r() * 0.6);
      this.bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.abs(Math.sin(a)) * v, life: 0.7, max: 0.7, color: colors[i % colors.length]!, size: size * (0.6 + this.r() * 0.8) });
    }
  }
  private pop(x: number, y: number, text: string, color: string) {
    this.bits.push({ x, y, vx: 0, vy: 1.2, life: 1.2, max: 1.2, color, size: 0.55, text });
  }
  private stepBits(dt: number) {
    for (const b of this.bits) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.92; b.vy = b.text ? b.vy * 0.95 : b.vy - 6 * dt; b.life -= dt;
    }
    if (this.bits.some((b) => b.life <= 0)) this.bits = this.bits.filter((b) => b.life > 0);
  }

  // ---- drawing (world y is up; screen y is down) ----
  draw(d: Draw) {
    const camX = this.x - BIKE_X;
    const baseY = 10; // screen row of the camera's ground height
    const sy = (wy: number) => baseY - (wy - this.camY);
    const sx = (wx: number) => wx - camX;
    const sunset = this.theme === "theme-sunset" || this.level.world === 2;
    // sky, sun and hills (parallax)
    const ctx = d.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(d.ox, d.oy, COLS * d.cell, ROWS * d.cell);
    ctx.clip(); // everything below stays inside the board
    const sky = ctx.createLinearGradient(0, d.oy, 0, d.oy + ROWS * d.cell);
    sky.addColorStop(0, sunset ? "#ff7a5c" : "#6bbcf2");
    sky.addColorStop(0.7, sunset ? "#ffc38a" : "#c4ebff");
    ctx.fillStyle = sky;
    ctx.fillRect(d.ox, d.oy, COLS * d.cell, ROWS * d.cell);
    d.circle(18 - (camX * 0.02) % 4, 3, 1.4, sunset ? "#ffe08a" : "#fff4b0");
    for (let i = -1; i < 6; i++) {
      const hx = i * 6 - ((camX * 0.25) % 6);
      d.circle(hx + 3, 11.5, 4.2, sunset ? "#c46a7a" : "#8fd18a");
    }
    for (let i = -1; i < 5; i++) {
      const cx = i * 7 - ((camX * 0.1) % 7);
      d.circle(cx + 2, 2.2, 0.6, "rgba(255,255,255,0.85)");
      d.circle(cx + 2.7, 2, 0.8, "rgba(255,255,255,0.85)");
      d.circle(cx + 3.5, 2.3, 0.6, "rgba(255,255,255,0.85)");
    }
    // the road
    const first = Math.max(0, Math.floor(camX) - 1), last = Math.min(this.track.length - 1, Math.ceil(camX + COLS) + 1);
    ctx.save();
    ctx.translate(d.ox, d.oy); // raw canvas paths below are in board pixels
    ctx.fillStyle = sunset ? "#6a8a4a" : "#5fae54";
    ctx.beginPath();
    ctx.moveTo(sx(first) * d.cell, ROWS * d.cell);
    for (let i = first; i <= last + 1; i++) ctx.lineTo(sx(i) * d.cell, sy(this.ground(Math.min(i, this.track.length - 0.001))) * d.cell);
    ctx.lineTo(sx(last + 1) * d.cell, ROWS * d.cell);
    ctx.fill();
    ctx.strokeStyle = "#c9a26b";
    ctx.lineWidth = d.cell * 0.22;
    ctx.beginPath();
    for (let i = first; i <= last + 1; i++) {
      const X = sx(i) * d.cell, Y = (sy(this.ground(Math.min(i, this.track.length - 0.001))) + 0.1) * d.cell;
      if (i === first) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    ctx.restore();
    // roadside scenery
    for (let i = first; i <= last; i++) {
      const G = sy(this.ground(i + 0.5));
      if (i % 7 === 3) { d.rect(sx(i + 0.5) - 0.06, G - 0.9, 0.12, 0.9, "#a0784e"); d.rect(sx(i + 0.5) - 0.5, G - 0.75, 1, 0.08, "#a0784e"); }
      if (i % 3 === 1) d.circle(sx(i + 0.2), G + 0.6, 0.12, sunset ? "#557a3c" : "#4c9a44");
      if (i % 5 === 2) d.circle(sx(i + 0.7), G + 1.4, 0.1, sunset ? "#557a3c" : "#4c9a44");
    }
    // things on the road
    for (let i = first; i <= last; i++) {
      const ch = this.track[i];
      const X = sx(i + 0.5), G = sy(this.ground(i + 0.5));
      if (ch === "L") {
        if (this.hitLogs.has(i)) d.rect(X - 0.5, G - 0.35, 1, 0.35, "#7a4f2a", 0.15);
        else { d.rect(X - 0.55, G - LOG_H, 1.1, LOG_H, "#8a5a32", 0.25); d.circle(X + 0.45, G - LOG_H / 2, LOG_H / 2, "#c49a6c"); d.circle(X + 0.45, G - LOG_H / 2, LOG_H / 4, "#a0784e"); }
      } else if (ch === "r") { d.circle(X, G - 0.12, 0.3, "#8a8f99"); d.circle(X - 0.08, G - 0.2, 0.14, "#a9aeb8"); }
      else if (ch === "~") d.rect(X - 0.55, G - 0.06, 1.1, 0.18, "#5aa8e0", 0.08);
      else if ((ch === "f" || ch === "*") && !this.flowers.has(i)) {
        const fy = G - (ch === "*" ? HIGH + 0.5 : 0.35) + Math.sin(d.t * 3 + i) * 0.08;
        if (ch === "*") d.rect(X - 0.02, fy, 0.04, G - fy, "rgba(255,255,255,0.35)");
        d.text(ch === "*" ? "🌸" : "🌼", X, fy, 0.55, "#000");
      } else if (ch === "F") {
        d.rect(X - 0.05, G - 3, 0.1, 3, "#ffffff");
        d.rect(X + 0.05, G - 3, 1.2, 0.7, "#ff5c9a");
        d.text("🧺", X + 1.5, G - 0.4, 0.8, "#000");
      }
    }
    // Grandpa Joe's ghost bike
    const joe = this.debug().joe;
    if (joe > camX - 2 && joe < camX + COLS + 2) {
      ctx.globalAlpha = 0.4;
      this.drawBike(d, sx(joe), sy(this.ground(joe)), ["#9aa0aa", "#9aa0aa"], this.ms / 140, 0, true);
      ctx.globalAlpha = 1;
      d.text("Joe", sx(joe), sy(this.ground(joe)) - 2.5, 0.38, "rgba(60,60,70,0.7)");
    }
    // our bike
    const wobble = this.crash > 0 ? Math.sin(this.crash / 40) * 0.12 : 0;
    if (this.inStep > 0) d.circle(BIKE_X, sy(this.ground(this.x) + this.air) - 1, 1.9, `rgba(255, 227, 107, ${0.3 * this.inStep})`);
    this.drawBike(d, BIKE_X + wobble, sy(this.ground(this.x) + this.air), this.colors, this.crank, this.slope(this.x), false);
    for (const b of this.bits) {
      ctx.globalAlpha = Math.max(0, b.life / b.max);
      if (b.text) d.text(b.text, sx(b.x), sy(b.y), b.size, b.color, 900);
      else d.circle(sx(b.x), sy(b.y), b.size, b.color);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** A tandem with two riders; (x, y) is the middle of the bike at road level. */
  private drawBike(d: Draw, x: number, y: number, colors: string[], crank: number, slope: number, ghost: boolean) {
    const ctx = d.ctx, C = d.cell;
    const frame = this.skin === "bike-mint" && !ghost ? "#3ee0b0" : this.skin === "bike-gold" && !ghost ? "#ffd23f" : ghost ? "#9aa0aa" : "#e94f4f";
    ctx.save();
    ctx.translate(d.ox + x * C, d.oy + y * C);
    ctx.rotate(-Math.atan(slope));
    const wheel = (wx: number) => {
      ctx.strokeStyle = "#2a2a33"; ctx.lineWidth = C * 0.1;
      ctx.beginPath(); ctx.arc(wx * C, -0.45 * C, 0.42 * C, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(42,42,51,0.6)"; ctx.lineWidth = C * 0.03;
      for (let k = 0; k < 3; k++) { const a = crank + (k * Math.PI) / 3; ctx.beginPath(); ctx.moveTo((wx + Math.cos(a) * 0.4) * C, (-0.45 + Math.sin(a) * 0.4) * C); ctx.lineTo((wx - Math.cos(a) * 0.4) * C, (-0.45 - Math.sin(a) * 0.4) * C); ctx.stroke(); }
    };
    wheel(-1.1);
    wheel(1.1);
    ctx.strokeStyle = frame; ctx.lineWidth = C * 0.12; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-1.1 * C, -0.45 * C); ctx.lineTo(-0.55 * C, -1.05 * C); ctx.lineTo(0.55 * C, -1.05 * C); ctx.lineTo(1.1 * C, -0.45 * C);
    ctx.moveTo(-0.55 * C, -1.05 * C); ctx.lineTo(-0.35 * C, -0.5 * C); ctx.lineTo(0.35 * C, -0.5 * C); ctx.lineTo(0.55 * C, -1.05 * C);
    ctx.moveTo(1.0 * C, -0.75 * C); ctx.lineTo(0.95 * C, -1.35 * C);
    ctx.stroke();
    // riders: back (player 2) then front (player 1)
    const rider = (rx: number, color: string, phase: number) => {
      const foot = { x: rx + 0.15 + Math.cos(crank + phase) * 0.18, y: -0.5 + Math.sin(crank + phase) * 0.18 };
      ctx.strokeStyle = "#3a3a4a"; ctx.lineWidth = C * 0.1;
      ctx.beginPath(); ctx.moveTo((rx - 0.05) * C, -1.15 * C); ctx.lineTo((rx + 0.15) * C, -0.8 * C); ctx.lineTo(foot.x * C, foot.y * C); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect((rx - 0.25) * C, -1.85 * C, 0.42 * C, 0.75 * C, 0.15 * C); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = C * 0.09;
      ctx.beginPath(); ctx.moveTo((rx + 0.05) * C, -1.65 * C); ctx.lineTo((rx + 0.55) * C, -1.3 * C); ctx.stroke();
      ctx.fillStyle = "#ffd9b8";
      ctx.beginPath(); ctx.arc((rx + 0.0) * C, -2.1 * C, 0.24 * C, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ghost ? "#c8ccd4" : color; // helmet
      ctx.beginPath(); ctx.arc(rx * C, -2.18 * C, 0.25 * C, Math.PI, 0); ctx.fill();
    };
    if (!this.solo || ghost) rider(-0.6, colors[1]!, Math.PI);
    rider(0.45, colors[0]!, 0);
    ctx.restore();
    if (!ghost) {
      d.text("1", x + 0.45, y - 1.5, 0.3, "#ffffff");
      if (!this.solo) d.text("2", x - 0.6, y - 1.5, 0.3, "#ffffff");
    }
  }
}
