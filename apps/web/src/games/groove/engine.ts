/**
 * Groove Party scoring: pure, no DOM, so it is unit-tested and replayed by bots.
 *
 * Every step of the routine is judged once per dancer. The phone stamps each gesture at its peak in TV time,
 * so judging uses when you moved, not when the packet arrived. Dancing is forgiving on purpose (people move
 * a little early or late, some mirror the coach, and a flick's swing back is a gesture of its own):
 *   the right move   within PERFECT / SUPER / GOOD ms of the beat   → 100 / 75 / 50
 *   the mirror move  (left for right)                              → GOOD at most
 *   another move     close to the beat: you're dancing, just not that move → OK, 20
 *   nothing                                                         → MISS
 * Mirror and other moves are only pencilled in: the right move inside the window still upgrades them, so a
 * swing back or a warm-up wiggle never steals a step. Nobody fails a song: it is for everyone in the room.
 * Two or more dancers nailing the same step (SUPER or better) is IN SYNC: each of them gets a bonus.
 */
import type { Difficulty, Step } from "./routine";
import { MOVES, matchOf } from "./moves";

export type Judgement = "perfect" | "super" | "good" | "ok" | "miss";
export const POINTS: Record<Judgement, number> = { perfect: 100, super: 75, good: 50, ok: 20, miss: 0 };
const RANK: Record<Judgement, number> = { miss: 0, ok: 1, good: 2, super: 3, perfect: 4 };

/** Timing windows in ms either side of the beat (the last one is the whole window a move can be judged in). */
export const WINDOWS: Record<Difficulty, { perfect: number; super: number; good: number }> = {
  easy: { perfect: 120, super: 220, good: 340 },
  normal: { perfect: 100, super: 180, good: 300 },
  hard: { perfect: 70, super: 130, good: 220 },
};
/** A move may also be danced while the coach still holds it (up to this long after the beat). */
const LATE_MAX = 380;
export const SYNC_BONUS = 25;
/** Streak lengths that raise the multiplier (×2 at 8, ×3 at 16, ×4 at 32). */
const STREAKS = [8, 16, 32];

export interface Dancer {
  score: number;
  streak: number;
  best: number;
  counts: Record<Judgement, number>;
  /** Step index → final judgement. */
  done: Map<number, Judgement>;
  /** Step index → pencilled-in judgement (a mirror or other move), final when the window closes. */
  maybe: Map<number, Judgement>;
  syncs: number;
}

export type DanceEvent =
  | { kind: "judge"; p: number; step: number; judgement: Judgement; points: number; streak: number }
  | { kind: "sync"; step: number; players: number[] }
  | { kind: "mult"; p: number; mult: number };

const blank = (): Dancer => ({
  score: 0, streak: 0, best: 0, counts: { perfect: 0, super: 0, good: 0, ok: 0, miss: 0 }, done: new Map(), maybe: new Map(), syncs: 0,
});

export class DanceRun {
  readonly dancers: Dancer[];
  /** Crowd hype 0..1: rises with good dancing from anyone, falls slowly. */
  hype = 0.3;
  private synced = new Set<number>();
  private lastT = 0;
  /** First step whose window may still be open (everything before it is judged for everyone). */
  private first = 0;
  readonly end: number;

  constructor(readonly steps: Step[], players: number, readonly difficulty: Difficulty, songMs?: number) {
    this.dancers = Array.from({ length: players }, blank);
    const last = steps[steps.length - 1];
    this.end = songMs ?? (last ? last.t + last.hold : 0);
  }

  mult(p: number): number {
    const s = this.dancers[p]!.streak;
    return 1 + STREAKS.filter((n) => s >= n).length;
  }

  private lateOf(s: Step) {
    return Math.min(LATE_MAX, Math.max(WINDOWS[this.difficulty].good, s.hold * 0.6));
  }

  /** Player p made a gesture at song time t. Returns what it scored now (pencilled moves score when the window closes). */
  dance(p: number, gesture: string, t: number): DanceEvent[] {
    const w = WINDOWS[this.difficulty];
    const x = this.dancers[p]!;
    // the open steps whose window holds t; prefer one this gesture is (or mirrors), then the nearest
    let best = -1, bestKey = Infinity;
    for (let i = this.first; i < this.steps.length; i++) {
      const s = this.steps[i]!;
      if (s.t - w.good > t) break;
      if (t > s.t + this.lateOf(s) || x.done.has(i)) continue;
      const m = matchOf(MOVES[s.move], gesture);
      const key = (m === "match" ? 0 : m === "mirror" ? 1e5 : 2e5) + Math.abs(t - s.t);
      if (key < bestKey) { best = i; bestKey = key; }
    }
    if (best < 0) return [];
    const s = this.steps[best]!;
    const m = matchOf(MOVES[s.move], gesture);
    const d = Math.abs(t - s.t);
    if (m === "match") {
      const j: Judgement = d <= w.perfect ? "perfect" : d <= w.super ? "super" : "good";
      return this.final(p, best, j);
    }
    if (m === "mirror") this.pencil(p, best, "good");
    else if (d <= w.super) this.pencil(p, best, "ok");
    return [];
  }

  private pencil(p: number, i: number, j: Judgement) {
    const x = this.dancers[p]!;
    const had = x.maybe.get(i);
    if (!had || RANK[j] > RANK[had]) x.maybe.set(i, j);
  }

  private final(p: number, i: number, j: Judgement): DanceEvent[] {
    const out = this.judge(p, i, j);
    if (j !== "perfect" && j !== "super") return out;
    if (this.synced.has(i)) {
      // joining a sync that already happened
      this.bonus(p);
      return out;
    }
    const nailed = this.dancers.flatMap((x, k) => (x.done.get(i) === "perfect" || x.done.get(i) === "super" ? [k] : []));
    if (nailed.length >= 2) {
      this.synced.add(i);
      for (const k of nailed) this.bonus(k);
      this.hype = Math.min(1, this.hype + 0.08);
      out.push({ kind: "sync", step: i, players: nailed });
    }
    return out;
  }

  private bonus(p: number) {
    const x = this.dancers[p]!;
    x.score += SYNC_BONUS * this.mult(p);
    x.syncs++;
  }

  private judge(p: number, i: number, j: Judgement): DanceEvent[] {
    const x = this.dancers[p]!;
    const before = this.mult(p);
    x.done.set(i, j);
    x.maybe.delete(i);
    x.counts[j]++;
    if (j === "miss" || j === "ok") x.streak = 0;
    else { x.streak++; x.best = Math.max(x.best, x.streak); }
    const points = j === "miss" ? 0 : POINTS[j] * before;
    x.score += points;
    const lift = j === "perfect" ? 0.03 : j === "super" ? 0.02 : j === "good" ? 0.01 : j === "miss" ? -0.025 : 0;
    this.hype = Math.max(0, Math.min(1, this.hype + lift / Math.max(1, this.dancers.length * 0.6)));
    const out: DanceEvent[] = [{ kind: "judge", p, step: i, judgement: j, points, streak: x.streak }];
    const after = this.mult(p);
    if (after !== before) out.push({ kind: "mult", p, mult: after });
    return out;
  }

  /** Advances to song time t: steps whose window has passed are settled (pencilled-in, or a miss). */
  update(t: number): DanceEvent[] {
    const out: DanceEvent[] = [];
    this.hype = Math.max(0.05, this.hype - Math.max(0, t - this.lastT) * 0.00002);
    this.lastT = t;
    while (this.first < this.steps.length) {
      const s = this.steps[this.first]!;
      if (t <= s.t + this.lateOf(s)) break;
      const i = this.first;
      this.dancers.forEach((x, p) => { if (!x.done.has(i)) out.push(...this.judge(p, i, x.maybe.get(i) ?? "miss")); });
      this.first++;
    }
    return out;
  }

  over(t: number) {
    return t > this.end + 600;
  }

  /** The 100% line: every step PERFECT, no streak multiplier or bonus. */
  get par(): number {
    return this.steps.length * POINTS.perfect;
  }

  /** How well p danced, 0..1. */
  accuracy(p: number): number {
    const c = this.dancers[p]!.counts;
    const raw = (Object.keys(c) as Judgement[]).reduce((a, k) => a + c[k] * POINTS[k], 0);
    return this.steps.length ? raw / this.par : 0;
  }

  /** Stars for the room, from its best dancer (anyone can carry the song; nobody drags it down). */
  stars(): number {
    const a = Math.max(0, ...this.dancers.map((_, p) => this.accuracy(p)));
    return a >= 0.85 ? 3 : a >= 0.65 ? 2 : a >= 0.4 ? 1 : 0;
  }

  /** The dancer's rating, from accuracy. */
  rating(p: number): string {
    const a = this.accuracy(p);
    return a >= 0.92 ? "SUPERSTAR" : a >= 0.8 ? "STAR" : a >= 0.65 ? "GROOVY" : a >= 0.45 ? "WARMING UP" : "KEEP MOVING";
  }
}
