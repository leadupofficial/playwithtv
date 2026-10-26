/**
 * Drop Four on the TV: player 0 (coral) against the level's opponent, or with two phones against player 1
 * (gold). ◀ ▶ (stick, touchpad slide or tilt) moves the disc over the rack, ✋ drops it, ↩ twice resigns.
 */
import type { Draw } from "../kitgrid/draw";
import { rng } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import type { Opponent } from "./levels";
import { drop, empty, four, full, type Grid, H, landing, thinking, W } from "./rules";

/** Slices of computer reading per frame (rules.ts SLICE positions each): the rest waits for the next frame. */
export const STEP_SLICES = 4;

const RX = 4.5; // rack's left edge (cells)
const RY = 2.6; // rack's top edge
const AI_DELAY = 650;
const REPEAT_FIRST = 300;
const REPEAT = 140;
const RESIGN_MS = 3000;
const G = 40; // cells/s² for the falling disc

const STAGES = {
  fair: { sky: "#3b2a5c", rack: "#2f6fd1", rim: "#1f4f9e", floor: "#5a3d7a" },
  pier: { sky: "#1f4a6b", rack: "#2e8f8a", rim: "#1d6662", floor: "#7a5a3a" },
  bigtop: { sky: "#5c1f2a", rack: "#c9a24a", rim: "#8f6f2a", floor: "#3a1f1f" },
};

interface Cursor { col: number; dir: number; next: number }

export class FourSim implements Sim {
  readonly cols = 16;
  readonly rows = 10;
  grid: Grid = empty();
  turn = 0;
  private cur: Cursor[] = [{ col: 3, dir: 0, next: 0 }, { col: 3, dir: 0, next: 0 }];
  private ms = 0;
  private aiAt = -1;
  /** Most search slices any one frame has run (tests: the TV never stalls on the computer's turn). */
  private aiPeak = 0;
  /** The computer's search in progress (started as soon as it is its turn, a few slices per frame), then its pick. */
  private ai: { it: Generator<void, number, void>; pick: number | null } | null = null;
  private falling: { col: number; row: number; y: number; vy: number; s: number; bounced: boolean } | null = null;
  private line: number[] | null = null;
  private drops = [0, 0];
  private resignAt = [-1e9, -1e9];
  private result: Outcome | null = null;
  private pendingEnd: (() => void) | null = null;
  private r: () => number;
  private duel: boolean;
  private names: string[];

  constructor(private opp: Opponent, seed: number, private skin: string, private colors: string[], names: string[] = [], private quick = false) {
    this.r = rng(seed);
    this.duel = colors.length >= 2;
    this.names = [names[0] ?? "You", this.duel ? names[1] ?? "Player 2" : opp.name];
  }

  private human(s: number) {
    return s === 0 || this.duel;
  }

  steer(p: number, x: number) {
    const c = this.cur[p];
    if (!c || this.result) return;
    const dir = x > 0.55 ? 1 : x < -0.55 ? -1 : 0;
    if (dir !== c.dir) {
      c.dir = dir;
      c.next = this.ms + REPEAT_FIRST;
      if (dir) c.col = Math.max(0, Math.min(W - 1, c.col + dir));
    } else if (dir && this.ms >= c.next) {
      c.next = this.ms + REPEAT;
      c.col = Math.max(0, Math.min(W - 1, c.col + dir));
    }
  }

  act(action: string, p = 0): SimEvent[] {
    if (this.result || this.pendingEnd) return [];
    if (action === "back") {
      if (!this.human(p)) return [];
      if (this.ms - this.resignAt[p]! < RESIGN_MS) {
        this.end(1 - p, `${this.names[p]} resigned`);
        return [{ sfx: "lose" }];
      }
      this.resignAt[p] = this.ms;
      return [{ toast: "Press ↩ again to give up this game", tone: "info", player: p }];
    }
    if (action !== "drop") return [];
    if (p !== this.turn || !this.human(this.turn)) return [{ toast: `Wait for ${this.names[this.turn]}`, tone: "info", player: p }];
    if (this.falling) return [];
    const col = this.cur[p]!.col;
    if (landing(this.grid, col) < 0) return [{ sfx: "lock", toast: "That column is full", tone: "bad", player: p, buzz: 60 }];
    return this.place(col);
  }

  private place(col: number): SimEvent[] {
    const s = this.turn;
    const row = drop(this.grid, col, s);
    this.drops[s]!++;
    this.falling = { col, row, y: -1, vy: 0, s, bounced: false };
    const line = four(this.grid, s);
    if (line) {
      this.pendingEnd = () => {
        this.line = line;
        this.end(s, `four in a row in ${this.drops[s]} drops`);
      };
    } else if (full(this.grid)) this.pendingEnd = () => this.end(-1, "the rack is full");
    else {
      this.turn = 1 - s;
      if (!this.human(this.turn)) {
        this.aiAt = this.ms + (this.quick ? 250 : AI_DELAY);
        this.ai = null; // a fresh search of this position
      }
    }
    return [{ sfx: "drop" }];
  }

  private end(winner: number, why: string) {
    const n = this.drops[0]!;
    const won = this.duel ? winner >= 0 : winner === 0;
    const quick = won && n <= 14, quicker = won && n <= 10;
    const stars = (!won || this.duel ? 0 : 1 + (quick ? 1 : 0) + (quicker ? 1 : 0)) as Outcome["stars"];
    const w = Math.max(0, winner);
    this.result = {
      won,
      stars,
      winner,
      headline: winner < 0 ? "A draw!" : this.duel ? `${this.names[w]} wins!` : won ? `You beat ${this.opp.name}!` : `${this.opp.name} wins`,
      score: winner < 0 ? 50 : 100 + Math.max(0, 21 - this.drops[w]!) * 10,
      checks: this.duel
        ? [{ text: winner < 0 ? why : `${this.names[w]}: ${why}`, ok: true }]
        : [
            { text: won ? `Beat ${this.opp.name}: ${why}` : why === "the rack is full" ? "A draw: the rack is full" : `${this.opp.name} got four in a row`, ok: won },
            { text: "Win in 14 drops or fewer", ok: quick },
            { text: "Win in 10 drops or fewer", ok: quicker },
          ],
    };
  }

  step(ms: number): SimEvent[] {
    const ev: SimEvent[] = [];
    this.ms += ms;
    const f = this.falling;
    if (f) {
      const dt = ms / 1000;
      const target = H - 1 - f.row; // screen row inside the rack (0 = top)
      f.vy += G * dt;
      f.y += f.vy * dt;
      if (f.y >= target) {
        if (!f.bounced && f.vy > 6) {
          f.y = target;
          f.vy = -f.vy * 0.25;
          f.bounced = true;
          ev.push({ sfx: "move" });
        } else {
          this.falling = null;
          if (this.pendingEnd) {
            const e = this.pendingEnd;
            this.pendingEnd = null;
            e();
            ev.push({ sfx: this.result!.winner === 0 || this.duel ? "clear" : "lose", shake: 0.2, buzz: 80 });
          }
        }
      }
    }
    if (!this.result && this.aiAt >= 0) {
      this.ai ??= { it: thinking(this.grid, this.turn, this.opp.brain, this.r), pick: null };
      let slices = 0;
      for (; slices < STEP_SLICES && this.ai.pick === null; slices++) {
        const n = this.ai.it.next();
        if (n.done) this.ai.pick = n.value;
      }
      this.aiPeak = Math.max(this.aiPeak, slices);
      if (!this.falling && this.ms >= this.aiAt && this.ai.pick !== null) {
        const c = this.ai.pick;
        this.aiAt = -1;
        this.ai = null;
        this.cur[1]!.col = c;
        ev.push(...this.place(c));
      }
    }
    return ev;
  }

  outcome() {
    return this.result;
  }

  hud(): Hud {
    const used = this.drops[0]! + this.drops[1]!;
    return {
      score: this.drops[0]!,
      goal: this.result ? "Game over" : `${this.names[this.turn]} to drop · ${W * H - used} spaces left`,
      progress: used / (W * H),
      seconds: this.ms / 1000,
    };
  }

  debug() {
    return {
      rows: Array.from({ length: H }, (_, i) => Array.from(this.grid.slice((H - 1 - i) * W, (H - i) * W), (v) => ".ox"[v]).join("")),
      turn: this.turn, cols: this.cur.map((c) => c.col), drops: [...this.drops], falling: !!this.falling, thinking: this.aiAt >= 0, aiPeak: this.aiPeak, duel: this.duel,
    };
  }

  // ---------------------------------------------------------------- drawing

  private disc(s: number) {
    const glow = this.skin === "discs-glow";
    return s === 0 ? (glow ? "#ff4fd8" : "#ff5c5c") : glow ? "#4fffe0" : "#ffd23f";
  }

  private coin(d: Draw, x: number, y: number, s: number, r = 0.4) {
    d.circle(x, y, r, s === 0 ? "#b8322f" : "#c79a1a");
    d.circle(x, y - 0.03, r * 0.84, this.disc(s));
    d.circle(x - r * 0.25, y - r * 0.3, r * 0.22, "rgba(255,255,255,0.35)");
  }

  draw(d: Draw) {
    const S = STAGES[this.opp.stage];
    d.rect(0, 0, this.cols, this.rows, S.sky);
    // bunting
    for (let i = 0; i < 16; i++) d.circle(i + 0.5, 0.35 + Math.sin(i * 1.3) * 0.08, 0.22, ["#ff5c9a", "#ffd23f", "#6bd6ff", "#9cff6b"][i % 4]!);
    d.rect(0, 9.1, this.cols, 0.9, S.floor);

    // the disc waiting to drop
    if (!this.result && !this.falling && !this.pendingEnd) {
      const c = this.cur[this.turn]!;
      const bob = Math.sin(d.t * 4) * 0.06;
      if (this.human(this.turn)) {
        this.coin(d, RX + c.col + 0.5, RY - 0.7 + bob, this.turn);
        const land = landing(this.grid, c.col);
        if (land >= 0) d.circle(RX + c.col + 0.5, RY + (H - 1 - land) + 0.5, 0.4, "rgba(255,255,255,0.18)");
      } else d.text("…", RX + 3.5, RY - 0.7, 0.6, "#ffffff");
    }
    // discs in the rack (behind the rack face)
    for (let i = 0; i < W * H; i++) {
      const v = this.grid[i]!;
      if (!v) continue;
      const col = i % W, row = Math.floor(i / W);
      if (this.falling && this.falling.col === col && this.falling.row === row) continue;
      this.coin(d, RX + col + 0.5, RY + (H - 1 - row) + 0.5, v - 1);
    }
    if (this.falling) this.coin(d, RX + this.falling.col + 0.5, RY + this.falling.y + 0.5, this.falling.s);
    // rack face with holes (drawn as rings so the discs show through)
    const ctx = d.ctx, C = d.cell;
    ctx.save();
    ctx.translate(d.ox, d.oy);
    ctx.fillStyle = S.rack;
    ctx.beginPath();
    ctx.roundRect((RX - 0.2) * C, (RY - 0.1) * C, (W + 0.4) * C, (H + 0.25) * C, 0.3 * C);
    for (let c = 0; c < W; c++) for (let r = 0; r < H; r++) {
      const x = (RX + c + 0.5) * C, y = (RY + r + 0.5) * C;
      ctx.moveTo(x + 0.42 * C, y);
      ctx.arc(x, y, 0.42 * C, 0, Math.PI * 2, true);
    }
    ctx.fill("evenodd");
    ctx.restore();
    d.rect(RX - 0.5, RY + H + 0.1, 0.5, 9.1 - RY - H - 0.1, S.rim);
    d.rect(RX + W, RY + H + 0.1, 0.5, 9.1 - RY - H - 0.1, S.rim);
    // the winning four
    if (this.line) for (const i of this.line) {
      const x = RX + (i % W) + 0.5, y = RY + (H - 1 - Math.floor(i / W)) + 0.5;
      d.circle(x, y, 0.18 + Math.sin(d.t * 8) * 0.05, "#ffffff");
    }

    // players
    const panel = (x: number, s: number) => {
      const turn = this.turn === s && !this.result;
      d.rect(x, 2.4, 3.4, 3.6, turn ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.2)", 0.3);
      if (!this.duel && s === 1) d.text(this.opp.emoji, x + 1.7, 3.3, 0.9, "#000");
      else this.coin(d, x + 1.7, 3.3, s, 0.45);
      d.text(this.names[s]!, x + 1.7, 4.35, 0.38, this.duel || s === 0 ? this.colors[s] ?? "#fff" : "#ffffff");
      d.text(`${this.drops[s]} dropped`, x + 1.7, 4.95, 0.3, "rgba(255,255,255,0.85)");
      if (turn) d.text(this.human(s) ? "your turn" : "thinking…", x + 1.7, 5.5, 0.3, "#ffe36b");
    };
    panel(0.4, 0);
    panel(12.2, 1);
  }
}
