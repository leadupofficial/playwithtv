/**
 * Beat Blade's rules, pure (no DOM, no clock): the Shell feeds song time, aims and cuts; the engine judges.
 *
 * Everyone plays the same beat map on one shared track, each player judged on their own: a block is cut for
 * a player when THEIR cut matches it (direction, near its lane, on the beat). Missing a block, cutting a bomb
 * or standing in a wall costs health and the combo. Easy cannot be failed.
 *
 *   score   judgement points (perfect 115, great 100, good 70) × the multiplier
 *   mult    ×1 → ×2 after 2 hits, ×4 after 4 more, ×8 after 8 more; a miss drops one step
 *   stars   ★ cleared · ★★ rank A (80 % accuracy) · ★★★ rank S (90 %) or a full combo
 */
import { HIT_WINDOWS, judgeHit, type HitWindows, type Judgement } from "@playwithtv/motion";
import type { Difficulty, Dir, Note } from "./beatmap";

export const LANES = 4;
export const POINTS: Record<Exclude<Judgement, "miss">, number> = { perfect: 115, great: 100, good: 70 };
const MULTS = [1, 2, 4, 8];
const NEXT = [2, 4, 8];

export const WINDOWS: Record<Difficulty, HitWindows> = {
  easy: scale(HIT_WINDOWS, 1.4),
  normal: HIT_WINDOWS,
  hard: scale(HIT_WINDOWS, 0.8),
};
/** How long a block is in view before its beat, ms. */
export const AHEAD: Record<Difficulty, number> = { easy: 1700, normal: 1350, hard: 1100 };

function scale(w: HitWindows, k: number): HitWindows {
  return { perfect: Math.round(w.perfect * k), great: Math.round(w.great * k), good: Math.round(w.good * k) };
}

export interface Runner {
  score: number;
  combo: number;
  maxCombo: number;
  /** Index into MULTS, and hits towards the next step. */
  level: number;
  progress: number;
  health: number;
  failed: boolean;
  hits: Record<Exclude<Judgement, "miss">, number>;
  misses: number;
  /** Judgement points earned (without the multiplier), for accuracy. */
  earned: number;
  /** Notes this player has dealt with (cut, missed, bombed, wall). */
  done: Set<number>;
  inWall: boolean;
}

export type RunEvent =
  | { kind: "hit"; p: number; note: number; judgement: Exclude<Judgement, "miss">; points: number; mult: number; dir: Dir }
  | { kind: "miss"; p: number; note: number; bad: boolean }
  | { kind: "bomb"; p: number; note: number }
  | { kind: "wall"; p: number }
  | { kind: "mult"; p: number; mult: number }
  | { kind: "fail"; p: number };

export type Rank = "S" | "A" | "B" | "C" | "D";

const lanes = (n: Note) => Array.from({ length: n.width ?? 1 }, (_, i) => n.lane + i);
/** A player's aim (-1 left … 1 right) → lane 0..3. */
export const laneOf = (x: number) => Math.max(0, Math.min(LANES - 1, Math.floor(((x + 1) / 2) * LANES)));

export class BeatRun {
  readonly runners: Runner[];
  readonly blocks: number;
  readonly end: number;
  private next = 0; // the first note that is not yet past for everyone (scan start)

  constructor(readonly notes: Note[], players: number, readonly difficulty: Difficulty) {
    this.runners = Array.from({ length: players }, () => ({
      score: 0, combo: 0, maxCombo: 0, level: 0, progress: 0, health: 0.6, failed: false,
      hits: { perfect: 0, great: 0, good: 0 }, misses: 0, earned: 0, done: new Set(), inWall: false,
    }));
    this.blocks = notes.filter((n) => n.kind === "block").length;
    this.end = notes.reduce((m, n) => Math.max(m, n.t + (n.len ?? 0)), 0) + 1200;
  }

  get windows() {
    return WINDOWS[this.difficulty];
  }

  /** A cut by player `p` at song time `t` (ms, already corrected for their delay), aimed at lane `lane`. */
  cut(p: number, dir: Exclude<Dir, "o">, t: number, lane: number): RunEvent[] {
    const r = this.runners[p];
    if (!r || r.failed) return [];
    const w = this.windows;
    let best = -1, bestD = Infinity, wrong = -1, wrongD = Infinity, bomb = -1;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.t > t + w.good) break;
      if (r.done.has(i) || n.kind === "wall") continue;
      const d = Math.abs(n.t - t);
      if (d > w.good) continue;
      if (n.kind === "bomb") {
        if (n.lane === lane && bomb < 0) bomb = i;
        continue;
      }
      if (Math.abs(n.lane - lane) > 1) continue; // one lane either side: the blade is long
      // the aimed lane wins a tie between two blocks on the same beat
      const dd = d + Math.abs(n.lane - lane) * 5;
      if (n.dir === "o" || n.dir === dir) {
        if (dd < bestD) { best = i; bestD = dd; }
      } else if (d <= w.great && dd < wrongD) { wrong = i; wrongD = dd; }
    }
    if (best >= 0) {
      const n = this.notes[best]!;
      const j = judgeHit(t, n.t, w) as Exclude<Judgement, "miss">;
      return this.hit(p, best, j, n.dir);
    }
    if (bomb >= 0) return this.hurt(p, bomb, "bomb");
    if (wrong >= 0) return this.hurt(p, wrong, "bad");
    return []; // a swing at nothing costs nothing
  }

  /** Every frame: blocks that went past are misses; walls hurt whoever stands in them. */
  update(t: number, aims: number[]): RunEvent[] {
    const out: RunEvent[] = [];
    const w = this.windows;
    let allPast = true;
    const inside = this.runners.map(() => false);
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i]!;
      if (n.t - AHEAD.easy > t) break;
      const past = n.kind === "wall" ? n.t + (n.len ?? 0) < t : n.t + w.good < t;
      this.runners.forEach((r, p) => {
        if (r.failed || r.done.has(i)) return;
        if (n.kind === "block" && past) out.push(...this.hurt(p, i, "miss"));
        else if (n.kind === "bomb" && past) r.done.add(i); // dodged
      });
      if (n.kind === "wall" && n.t <= t && !past) {
        this.runners.forEach((_, p) => {
          if (lanes(n).includes(laneOf(aims[p] ?? 0))) inside[p] = true;
        });
      }
      if (allPast && past) this.next = i + 1;
      else allPast = false;
    }
    this.runners.forEach((r, p) => {
      if (r.failed) return;
      if (inside[p] && !r.inWall) out.push(...this.hurt(p, -1, "wall"));
      if (inside[p]) this.drain(p, 0.004, out);
      r.inWall = inside[p]!;
    });
    return out;
  }

  private hit(p: number, i: number, j: Exclude<Judgement, "miss">, dir: Dir): RunEvent[] {
    const r = this.runners[p]!;
    const out: RunEvent[] = [];
    r.done.add(i);
    r.hits[j]++;
    r.combo++;
    r.maxCombo = Math.max(r.maxCombo, r.combo);
    r.earned += POINTS[j];
    if (r.level < NEXT.length && ++r.progress >= NEXT[r.level]!) {
      r.level++;
      r.progress = 0;
      out.push({ kind: "mult", p, mult: MULTS[r.level]! });
    }
    const mult = MULTS[r.level]!;
    r.score += POINTS[j] * mult;
    r.health = Math.min(1, r.health + (j === "good" ? 0.01 : 0.02));
    out.unshift({ kind: "hit", p, note: i, judgement: j, points: POINTS[j] * mult, mult, dir });
    return out;
  }

  private hurt(p: number, i: number, why: "miss" | "bad" | "bomb" | "wall"): RunEvent[] {
    const r = this.runners[p]!;
    const out: RunEvent[] = [];
    if (why !== "wall") r.done.add(i);
    if (why === "miss" || why === "bad") {
      r.misses++;
      out.push({ kind: "miss", p, note: i, bad: why === "bad" });
    } else out.push(why === "bomb" ? { kind: "bomb", p, note: i } : { kind: "wall", p });
    r.combo = 0;
    if (r.level > 0) {
      r.level--;
      out.push({ kind: "mult", p, mult: MULTS[r.level]! });
    }
    r.progress = 0;
    this.drain(p, why === "bomb" ? 0.15 : why === "wall" ? 0.08 : 0.1, out);
    return out;
  }

  private drain(p: number, amount: number, out: RunEvent[]) {
    const r = this.runners[p]!;
    r.health = Math.max(this.difficulty === "easy" ? 0.05 : 0, r.health - amount);
    if (r.health <= 0 && !r.failed) {
      r.failed = true;
      out.push({ kind: "fail", p });
    }
  }

  /** Everyone has failed, or the song is over. */
  over(t: number): boolean {
    return t >= this.end || this.runners.every((r) => r.failed);
  }

  mult(p: number): number {
    return MULTS[this.runners[p]?.level ?? 0]!;
  }

  accuracy(p: number): number {
    const r = this.runners[p];
    return r && this.blocks ? r.earned / (POINTS.perfect * this.blocks) : 0;
  }

  rank(p: number): Rank {
    const a = this.accuracy(p);
    return a >= 0.9 ? "S" : a >= 0.8 ? "A" : a >= 0.65 ? "B" : a >= 0.5 ? "C" : "D";
  }

  fullCombo(p: number): boolean {
    const r = this.runners[p];
    return !!r && r.misses === 0 && r.hits.perfect + r.hits.great + r.hits.good === this.blocks;
  }

  stars(p: number): number {
    const r = this.runners[p];
    if (!r || r.failed) return 0;
    const rk = this.rank(p);
    return rk === "S" || this.fullCombo(p) ? 3 : rk === "A" ? 2 : 1;
  }

  /** The team's result: the best player's stars (a song is cleared when anyone clears it). */
  teamStars(): number {
    return Math.max(0, ...this.runners.map((_, p) => this.stars(p)));
  }
}
