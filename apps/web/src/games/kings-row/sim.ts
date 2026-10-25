/**
 * Kings Row on the TV: one draughts game. Player 0 (bottom, red) against the level's opponent, or with two
 * phones against player 1 (top, dark). Each player moves a cursor with the arrows / stick / tilt; ✋ picks a
 * piece up and ✋ again puts it down (one hop at a time for multi-jumps), ↩ puts it back, and ↩ twice resigns.
 */
import type { Draw } from "../kitgrid/draw";
import { rng } from "../kitgrid/rng";
import type { Hud, Outcome, Sim, SimEvent } from "../kitgrid/types";
import type { Opponent } from "./levels";
import { type Board, count, DRAW_PLIES, moves, type Move, play, side, startBoard, think } from "./rules";

const BX = 4; // board's left column
const BY = 1;
const AI_DELAY = 750;
const HOP_MS = 180;
const REPEAT_FIRST = 300;
const REPEAT = 130;
const RESIGN_MS = 3000;

const TABLES = {
  park: { light: "#e9dcc0", dark: "#7d9a5c", frame: "#8a6a45", felt: "#4f7a3c" },
  cafe: { light: "#f2e2c8", dark: "#a5663f", frame: "#5a3825", felt: "#3c2a22" },
  hall: { light: "#ece6da", dark: "#3f4a6b", frame: "#c9a24a", felt: "#2a1f3a" },
};

interface Cursor { sq: number; dir: string; next: number }

export class KingsSim implements Sim {
  readonly cols = 16;
  readonly rows = 10;
  board: Board;
  turn = 0;
  private legal: Move[];
  private sel: number[] = [];
  private cur: Cursor[];
  private ms = 0;
  private plies = 0;
  private quiet = 0; // plies without a capture or a man moving
  private aiAt = -1;
  private last: { move: Move; at: number; piece: number } | null = null;
  private fallen: Array<{ sq: number; piece: number; at: number }> = [];
  private crowned = [0, 0];
  private lost = [0, 0];
  private resignAt = [-1e9, -1e9];
  private result: Outcome | null = null;
  private r: () => number;
  private duel: boolean;
  private names: string[];

  constructor(private opp: Opponent, seed: number, private skin: string, private colors: string[], names: string[] = [], private quick = false) {
    this.r = rng(seed);
    this.duel = colors.length >= 2;
    this.names = [names[0] ?? "You", this.duel ? names[1] ?? "Player 2" : opp.name];
    this.board = startBoard();
    this.legal = moves(this.board, 0);
    this.cur = [{ sq: 5 * 8 + 0, dir: "", next: 0 }, { sq: 2 * 8 + 1, dir: "", next: 0 }];
    this.cur[0]!.sq = this.legal[0]!.path[0]!;
  }

  private human(s: number) {
    return s === 0 || this.duel;
  }

  // ---------------------------------------------------------------- input

  steer(p: number, x: number, y: number) {
    const c = this.cur[p];
    if (!c || this.result) return;
    const ax = Math.abs(x), ay = Math.abs(y);
    const dir = Math.max(ax, ay) < 0.55 ? "" : ax > ay ? (x > 0 ? "R" : "L") : y > 0 ? "U" : "D";
    if (dir !== c.dir) {
      c.dir = dir;
      c.next = this.ms + REPEAT_FIRST;
      if (dir) this.nudge(c, dir);
    } else if (dir && this.ms >= c.next) {
      c.next = this.ms + REPEAT;
      this.nudge(c, dir);
    }
  }

  private nudge(c: Cursor, dir: string) {
    const x = c.sq & 7, y = c.sq >> 3;
    const nx = Math.max(0, Math.min(7, x + (dir === "R" ? 1 : dir === "L" ? -1 : 0)));
    const ny = Math.max(0, Math.min(7, y + (dir === "D" ? 1 : dir === "U" ? -1 : 0)));
    c.sq = ny * 8 + nx;
  }

  act(action: string, p = 0): SimEvent[] {
    if (this.result) return [];
    if (action === "back") return this.back(p);
    if (action !== "pick") return [];
    if (!this.human(this.turn) || p !== this.turn) return [{ toast: `Wait for ${this.names[this.turn]}'s move`, tone: "info", player: p }];
    const sq = this.cur[p]!.sq;
    const mine = side(this.board[sq]!) === this.turn;
    const movable = this.legal.some((m) => m.path[0] === sq);
    if (this.sel.length <= 1 && mine) {
      if (this.sel[0] === sq) {
        this.sel = [];
        return [{ sfx: "back" }];
      }
      if (movable) {
        this.sel = [sq];
        return [{ sfx: "select" }];
      }
      const forced = this.legal[0]?.caps.length;
      return [{ sfx: "lock", toast: forced ? "You must jump! Pick a piece that can capture" : "That piece can't move", tone: "bad", player: p, buzz: 60 }];
    }
    if (!this.sel.length) return [{ sfx: "lock", toast: "Pick one of your own pieces", tone: "info", player: p }];
    const prefix = [...this.sel, sq];
    const fits = this.legal.filter((m) => prefix.every((v, i) => m.path[i] === v));
    if (!fits.length) return [{ sfx: "lock", toast: this.legal.some((m) => m.path[0] === this.sel[0] && m.caps.length) ? "You must jump!" : "Can't go there", tone: "bad", player: p, buzz: 60 }];
    const done = fits.find((m) => m.path.length === prefix.length);
    if (!done) {
      this.sel = prefix;
      return [{ sfx: "move" }];
    }
    return this.commit(done);
  }

  private back(p: number): SimEvent[] {
    if (this.sel.length && p === this.turn) {
      this.sel = [];
      return [{ sfx: "back" }];
    }
    if (!this.human(p) && !this.duel) return [];
    if (this.ms - this.resignAt[p]! < RESIGN_MS) {
      this.end(1 - p, `${this.names[p]} resigned`);
      return [{ sfx: "lose" }];
    }
    this.resignAt[p] = this.ms;
    return [{ toast: "Press ↩ again to give up this game", tone: "info", player: p }];
  }

  private commit(m: Move): SimEvent[] {
    const ev: SimEvent[] = [];
    const piece = this.board[m.path[0]!]!;
    for (const c of m.caps) this.fallen.push({ sq: c, piece: this.board[c]!, at: this.ms + HOP_MS * (m.caps.indexOf(c) + 1) });
    const after = play(this.board, m);
    const to = m.path[m.path.length - 1]!;
    const s = this.turn;
    const king = Math.abs(after[to]!) === 2 && Math.abs(piece) === 1;
    this.lost[1 - s]! += m.caps.length;
    this.board = after;
    this.last = { move: m, at: this.ms, piece: after[to]! };
    this.sel = [];
    this.plies++;
    this.quiet = m.caps.length || Math.abs(piece) === 1 ? 0 : this.quiet + 1;
    if (m.caps.length) ev.push({ sfx: "hit", shake: 0.12 * m.caps.length, buzz: 40 });
    else ev.push({ sfx: "move" });
    if (m.caps.length >= 2) ev.push({ sfx: "bonus", toast: `${m.caps.length}-piece jump!`, tone: "good", player: this.duel ? s : 0 });
    if (king) {
      this.crowned[s]!++;
      ev.push({ sfx: "power", toast: s === 0 || this.duel ? "Crowned! Kings move both ways" : undefined, tone: "good", player: this.duel ? s : 0 });
    }
    this.turn = 1 - s;
    this.legal = moves(this.board, this.turn);
    if (!this.legal.length) this.end(s, count(this.board, this.turn).all ? `${this.names[this.turn]} is blocked in` : `${this.names[this.turn]} has no pieces left`);
    else if (this.quiet >= DRAW_PLIES) this.end(-1, "50 moves without a capture");
    else if (!this.human(this.turn)) this.aiAt = this.ms + (this.quick ? 250 : AI_DELAY);
    else {
      // a friendly start: the cursor jumps to a piece that has to capture, if any
      const c = this.cur[this.turn]!;
      if (this.legal[0]!.caps.length && !this.legal.some((x) => x.path[0] === c.sq)) c.sq = this.legal[0]!.path[0]!;
      if (this.duel) ev.push({ toast: m.caps.length && this.legal[0]!.caps.length ? "Your move. You must jump!" : "Your move", tone: "info", player: this.turn });
    }
    if (this.result) ev.push({ sfx: this.result.winner === 0 || this.duel ? "clear" : "lose" });
    return ev;
  }

  private end(winner: number, why: string) {
    const mine = count(this.board, 0);
    const kept = mine.all >= 6, kings = this.crowned[0]! >= 2;
    const won = this.duel ? winner >= 0 : winner === 0;
    const stars = (!won || this.duel ? 0 : 1 + (kept ? 1 : 0) + (kept && kings ? 1 : 0)) as Outcome["stars"];
    const w = Math.max(0, winner);
    this.result = {
      won,
      stars,
      winner,
      headline: winner < 0 ? "A draw!" : this.duel ? `${this.names[w]} wins!` : won ? `You beat ${this.opp.name}!` : `${this.opp.name} wins`,
      score: winner < 0 ? 50 : 100 + count(this.board, w).all * 10 + count(this.board, w).kings * 10,
      checks: this.duel
        ? [{ text: why, ok: true }, { text: `${this.plies} moves · ${this.names[0]} lost ${this.lost[0]}, ${this.names[1]} lost ${this.lost[1]}`, ok: true }]
        : [
            { text: won ? `Beat ${this.opp.name} (${why})` : why, ok: won },
            { text: `Finish with 6 or more pieces (${mine.all})`, ok: won && kept },
            { text: `…and crown 2 kings (${this.crowned[0]})`, ok: won && kept && kings },
          ],
    };
  }

  step(ms: number): SimEvent[] {
    this.ms += ms;
    this.fallen = this.fallen.filter((f) => this.ms - f.at < 500);
    if (this.result || this.aiAt < 0 || this.ms < this.aiAt) return [];
    this.aiAt = -1;
    const m = think(this.board, this.turn, this.opp.brain, this.r);
    return m ? this.commit(m) : [];
  }

  outcome() {
    return this.result;
  }

  hud(): Hud {
    const a = count(this.board, 0).all, b = count(this.board, 1).all;
    return {
      score: (12 - b) * 10,
      goal: `${this.result ? "Game over" : `${this.names[this.turn]} to move`} · ${a} vs ${b} pieces`,
      progress: (12 - b) / 12,
      seconds: this.ms / 1000,
    };
  }

  debug() {
    const ch = (p: number) => (p === 1 ? "o" : p === 2 ? "O" : p === -1 ? "x" : p === -2 ? "X" : ".");
    return {
      board: Array.from({ length: 8 }, (_, y) => Array.from(this.board.slice(y * 8, y * 8 + 8), ch).join("")),
      turn: this.turn, sel: [...this.sel], cursors: this.cur.map((c) => c.sq), plies: this.plies, legal: this.legal.length,
      forced: !!this.legal[0]?.caps.length, thinking: this.aiAt >= 0, duel: this.duel,
    };
  }

  /** Tests: the legal moves right now. */
  legalMoves() {
    return this.legal;
  }

  // ---------------------------------------------------------------- drawing

  draw(d: Draw) {
    const T = TABLES[this.opp.table];
    const sqX = (i: number) => BX + (i & 7) + 0.5, sqY = (i: number) => BY + (i >> 3) + 0.5;
    d.rect(0, 0, this.cols, this.rows, T.felt);
    d.rect(BX - 0.35, BY - 0.35, 8.7, 8.7, T.frame, 0.25);
    for (let i = 0; i < 64; i++) d.rect(BX + (i & 7), BY + (i >> 3), 1, 1, ((i >> 3) + (i & 7)) % 2 ? T.dark : T.light);

    const human = this.human(this.turn) && !this.result;
    // where the player to move can go
    if (human) {
      const c = this.cur[this.turn]!;
      const fits = this.sel.length ? this.legal.filter((m) => this.sel.every((v, i) => m.path[i] === v)) : [];
      if (!this.sel.length) for (const m of this.legal) d.circle(sqX(m.path[0]!), sqY(m.path[0]!), 0.47, "rgba(255, 236, 140, 0.35)");
      for (const m of fits) {
        const nx = m.path[this.sel.length]!;
        d.circle(sqX(nx), sqY(nx), 0.18 + Math.sin(d.t * 6) * 0.03, "rgba(255, 236, 140, 0.9)");
      }
      for (let k = 1; k < this.sel.length; k++) d.circle(sqX(this.sel[k]!), sqY(this.sel[k]!), 0.12, "rgba(255,255,255,0.8)");
      void c;
    }
    // the last move's trail
    if (this.last) for (const sq of this.last.move.path.slice(0, -1)) d.rect(BX + (sq & 7) + 0.06, BY + (sq >> 3) + 0.06, 0.88, 0.88, "rgba(255, 220, 120, 0.22)", 0.1);

    // pieces (the one that just moved slides along its path)
    const anim = this.last && this.ms - this.last.at < HOP_MS * (this.last.move.path.length - 1) ? this.last : null;
    const animTo = anim ? anim.move.path[anim.move.path.length - 1]! : -1;
    for (let i = 0; i < 64; i++) {
      const p = this.board[i]!;
      if (!p || i === animTo) continue;
      const lift = this.sel[0] === i ? 0.12 + Math.sin(d.t * 5) * 0.03 : 0;
      this.piece(d, sqX(i), sqY(i) - lift, p, lift > 0);
    }
    for (const f of this.fallen) if (this.ms < f.at) this.piece(d, sqX(f.sq), sqY(f.sq), f.piece, false);
    else this.burst(d, sqX(f.sq), sqY(f.sq), (this.ms - f.at) / 500);
    if (anim) {
      const k = (this.ms - anim.at) / HOP_MS;
      const seg = Math.min(anim.move.path.length - 2, Math.floor(k)), f = k - seg;
      const a = anim.move.path[seg]!, b = anim.move.path[seg + 1]!;
      const hop = anim.move.caps.length ? Math.sin(f * Math.PI) * 0.45 : 0;
      this.piece(d, sqX(a) + (sqX(b) - sqX(a)) * f, sqY(a) + (sqY(b) - sqY(a)) * f - hop, anim.piece, true);
    }

    // cursors
    if (!this.result) {
      for (const p of this.duel ? [0, 1] : [0]) {
        const c = this.cur[p]!;
        const active = p === this.turn;
        const col = this.colors[p] ?? "#ffffff";
        const x = BX + (c.sq & 7), y = BY + (c.sq >> 3);
        const a = active ? 1 : 0.35, w = 0.09;
        d.ctx.globalAlpha = a;
        d.rect(x, y, 1, w, col); d.rect(x, y + 1 - w, 1, w, col); d.rect(x, y, w, 1, col); d.rect(x + 1 - w, y, w, 1, col);
        d.ctx.globalAlpha = 1;
      }
    }

    // the two players
    const panel = (x: number, s: number) => {
      const turn = this.turn === s && !this.result;
      d.rect(x, 1.2, 3.2, 3.6, turn ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)", 0.3);
      if (!this.duel && s === 1) d.text(this.opp.emoji, x + 1.6, 2.1, 0.9, "#000");
      else this.piece(d, x + 1.6, 2.1, s === 0 ? 1 : -1, false);
      d.text(this.names[s]!, x + 1.6, 3.15, 0.38, s === 0 || this.duel ? this.colors[s] ?? "#fff" : "#ffffff");
      const n = count(this.board, s);
      d.text(`${n.all} left${n.kings ? ` · ${n.kings} 👑` : ""}`, x + 1.6, 3.75, 0.3, "rgba(255,255,255,0.85)");
      if (turn) d.text(this.human(s) ? "your move" : "thinking…", x + 1.6, 4.3, 0.28, "#ffe36b");
      // pieces this side has taken
      const took = 12 - count(this.board, 1 - s).all;
      for (let k = 0; k < took; k++) this.piece(d, x + 0.55 + (k % 4) * 0.7, 5.5 + Math.floor(k / 4) * 0.7, s === 0 ? -1 : 1, false, 0.28);
    };
    panel(0.4, 0);
    panel(12.4, 1);
  }

  private piece(d: Draw, x: number, y: number, p: number, lifted: boolean, r = 0.4) {
    const s = side(p);
    const marble = this.skin === "pieces-marble", gold = this.skin === "kings-gold";
    const base = s === 0 ? (marble ? "#f1ece4" : "#d8433b") : marble ? "#3a3d48" : "#2b2b33";
    const rim = s === 0 ? (marble ? "#c9c1b4" : "#9e2a24") : "#15151b";
    d.circle(x + 0.04, y + 0.07 + (lifted ? 0.08 : 0), r, "rgba(0,0,0,0.35)");
    d.circle(x, y, r, rim);
    d.circle(x, y - 0.04, r * 0.86, base);
    d.circle(x, y - 0.04, r * 0.55, s === 0 ? (marble ? "#e4ddd2" : "#c23a33") : "#383843");
    if (Math.abs(p) === 2) d.text("♛", x, y - 0.04, r * 1.05, gold ? "#ffd23f" : s === 0 && !marble ? "#ffe9a8" : "#e8c66a");
  }

  private burst(d: Draw, x: number, y: number, k: number) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      d.ctx.globalAlpha = 1 - k;
      d.circle(x + Math.cos(a) * k * 0.7, y + Math.sin(a) * k * 0.7, 0.08, "#ffe36b");
    }
    d.ctx.globalAlpha = 1;
  }
}
