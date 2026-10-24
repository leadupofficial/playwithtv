/**
 * Memory Wave rules, pure (no DOM): the TV plays a growing sequence of four directions, then every player
 * repeats it on their own phone at the same time. A wrong step or running out of time costs a life; with no
 * lives left a player is out. Each round adds one step and plays a little faster. Times are in milliseconds
 * and the game advances in fixed steps (`tick`), so a match is reproducible from its seed.
 */
import { placings } from "../scoring";

export type Dir = "up" | "right" | "down" | "left";
export const DIRS: Dir[] = ["up", "right", "down", "left"];

export interface MemoryConfig {
  /** Steps in the first round; every round adds one. */
  startLen: number;
  maxRounds: number;
  lives: number;
  /** Pause after each round to show who got it. */
  resultMs: number;
  /** "Watch!" lead-in before the first step is shown. */
  leadMs: number;
}

export const NORMAL: MemoryConfig = { startLen: 3, maxRounds: 12, lives: 3, resultMs: 2200, leadMs: 900 };
/** ?quick=1: three short rounds (2, 3 and 4 steps). */
export const QUICK: MemoryConfig = { startLen: 2, maxRounds: 3, lives: 3, resultMs: 1400, leadMs: 600 };

export type Phase = "show" | "input" | "result" | "over";

export interface PlayerState {
  id: string;
  lives: number;
  out: boolean;
  /** The round (0-based) in which this player lost their last life. */
  outRound: number | null;
  /** Correct steps entered this round. */
  progress: number;
  /** This round: still entering, completed it, made a mistake, or ran out of time. */
  status: "entering" | "done" | "wrong" | "slow";
  /** The step they got wrong this round (for the red cross on the TV). */
  wrongAt: number | null;
  points: number;
  cleared: number;
  /** Time limit for entering this round's sequence (set per player: motion gets longer). */
  limitMs: number;
}

export interface MemoryGame {
  cfg: MemoryConfig;
  /** The whole sequence for the match; round r plays its first `startLen + r` steps. */
  seq: Dir[];
  round: number;
  phase: Phase;
  /** Time spent in the current phase. */
  t: number;
  players: PlayerState[];
  /** Ids in finishing order once the game is over (best first). */
  winners: string[];
}

export type MemoryEvent =
  | { kind: "show-step"; index: number; dir: Dir }
  | { kind: "input-start"; round: number; len: number }
  | { kind: "step"; id: string; index: number; dir: Dir }
  | { kind: "done"; id: string }
  | { kind: "wrong"; id: string; index: number; expected: Dir; got: Dir }
  | { kind: "slow"; id: string }
  | { kind: "life-lost"; id: string; lives: number }
  | { kind: "out"; id: string }
  | { kind: "round-end"; round: number }
  | { kind: "round-start"; round: number; len: number }
  | { kind: "over"; winners: string[] };

/** Small seeded PRNG (mulberry32) so a match is reproducible in tests. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random sequence that never repeats one direction three times in a row (hard to count, and slow to flick). */
export function makeSequence(len: number, rand: () => number): Dir[] {
  const out: Dir[] = [];
  while (out.length < len) {
    const d = DIRS[Math.floor(rand() * 4) % 4]!;
    const n = out.length;
    if (n >= 2 && out[n - 1] === d && out[n - 2] === d) continue;
    out.push(d);
  }
  return out;
}

/** How fast the TV plays round `round` (0-based): every round is quicker, down to a floor. */
export function timing(round: number): { stepMs: number; gapMs: number } {
  return { stepMs: Math.max(300, 680 - 45 * round), gapMs: Math.max(110, 240 - 15 * round) };
}

/** Time to repeat `len` steps. Gestures take longer than taps, so motion players get more time (fair mixed modes). */
export function inputLimit(len: number, mode: "buttons" | "motion" | "hybrid" | "touchpad" = "buttons"): number {
  const per = mode === "motion" ? 1500 : mode === "touchpad" ? 1000 : 850;
  return 3000 + len * per;
}

export function newGame(ids: string[], cfg: MemoryConfig = NORMAL, seed = 1): MemoryGame {
  const rand = rng(seed);
  return {
    cfg,
    seq: makeSequence(cfg.startLen + cfg.maxRounds, rand),
    round: 0,
    phase: "show",
    t: 0,
    players: ids.map((id) => ({
      id, lives: cfg.lives, out: false, outRound: null, progress: 0, status: "entering", wrongAt: null, points: 0, cleared: 0, limitMs: inputLimit(cfg.startLen),
    })),
    winners: [],
  };
}

export const roundLen = (g: MemoryGame, round = g.round) => g.cfg.startLen + round;
/** The steps players must repeat this round. */
export const currentSeq = (g: MemoryGame): Dir[] => g.seq.slice(0, roundLen(g));
export function showMs(g: MemoryGame): number {
  const { stepMs, gapMs } = timing(g.round);
  return g.cfg.leadMs + roundLen(g) * (stepMs + gapMs);
}

/** Which step the TV is lighting at time `t` of the show phase, or -1 between steps / during the lead-in. */
export function litStep(g: MemoryGame, t = g.t): number {
  if (g.phase !== "show") return -1;
  const { stepMs, gapMs } = timing(g.round);
  const s = t - g.cfg.leadMs;
  if (s < 0) return -1;
  const i = Math.floor(s / (stepMs + gapMs));
  if (i >= roundLen(g)) return -1;
  return s - i * (stepMs + gapMs) < stepMs ? i : -1;
}

export const alive = (g: MemoryGame) => g.players.filter((p) => !p.out);
const player = (g: MemoryGame, id: string) => g.players.find((p) => p.id === id);

function loseLife(g: MemoryGame, p: PlayerState, ev: MemoryEvent[]) {
  p.lives = Math.max(0, p.lives - 1);
  ev.push({ kind: "life-lost", id: p.id, lives: p.lives });
  if (p.lives === 0) {
    p.out = true;
    p.outRound = g.round;
    ev.push({ kind: "out", id: p.id });
  }
}

/** A player's direction. Only counts while entering during the input phase. */
export function input(g: MemoryGame, id: string, dir: Dir): MemoryEvent[] {
  const p = player(g, id);
  if (!p || p.out || g.phase !== "input" || p.status !== "entering") return [];
  const seq = currentSeq(g);
  const expected = seq[p.progress]!;
  const ev: MemoryEvent[] = [];
  if (dir !== expected) {
    p.status = "wrong";
    p.wrongAt = p.progress;
    ev.push({ kind: "wrong", id, index: p.progress, expected, got: dir });
    loseLife(g, p, ev);
    return ev;
  }
  ev.push({ kind: "step", id, index: p.progress, dir });
  p.progress++;
  p.points += 10;
  if (p.progress >= seq.length) {
    p.status = "done";
    p.cleared++;
    p.points += 50;
    ev.push({ kind: "done", id });
  }
  return ev;
}

function startRound(g: MemoryGame, ev: MemoryEvent[]) {
  g.phase = "show";
  g.t = 0;
  ev.push({ kind: "round-start", round: g.round, len: roundLen(g) });
}

function finish(g: MemoryGame, ev: MemoryEvent[]) {
  g.phase = "over";
  g.t = 0;
  g.winners = ranking(g).filter((r) => r.place === 1).map((r) => r.id);
  ev.push({ kind: "over", winners: g.winners });
}

/**
 * Advances the game by `dt` ms. `limits` gives each player's time to repeat this round (by their control
 * mode); it is read when the input phase begins.
 */
export function tick(g: MemoryGame, dt: number, limits: (id: string, len: number) => number = (_, len) => inputLimit(len)): MemoryEvent[] {
  const ev: MemoryEvent[] = [];
  if (g.phase === "over") return ev;
  const before = litStep(g);
  g.t += dt;
  if (g.phase === "show") {
    const now = litStep(g);
    if (now >= 0 && now !== before) ev.push({ kind: "show-step", index: now, dir: g.seq[now]! });
    if (g.t >= showMs(g)) {
      g.phase = "input";
      g.t = 0;
      for (const p of alive(g)) {
        p.progress = 0;
        p.status = "entering";
        p.wrongAt = null;
        p.limitMs = limits(p.id, roundLen(g));
      }
      ev.push({ kind: "input-start", round: g.round, len: roundLen(g) });
    }
  } else if (g.phase === "input") {
    for (const p of alive(g)) {
      if (p.status === "entering" && g.t >= p.limitMs) {
        p.status = "slow";
        ev.push({ kind: "slow", id: p.id });
        loseLife(g, p, ev);
      }
    }
    // everyone who played this round has finished (got it, slipped, or ran out of time)
    if (g.players.every((p) => p.status !== "entering")) {
      g.phase = "result";
      g.t = 0;
      ev.push({ kind: "round-end", round: g.round });
    }
  } else if (g.phase === "result" && g.t >= g.cfg.resultMs) {
    const left = alive(g).length;
    const multi = g.players.length > 1;
    if (left === 0 || (multi && left === 1) || g.round + 1 >= g.cfg.maxRounds) finish(g, ev);
    else {
      g.round++;
      for (const p of alive(g)) {
        p.progress = 0;
        p.status = "entering";
        p.wrongAt = null;
      }
      startRound(g, ev);
    }
  }
  return ev;
}

/**
 * Final standings: whoever lasted longest ranks first (still in at the end beats knocked out; knocked out
 * later beats knocked out earlier), then the most points. Equal records share a place (games/scoring.ts).
 */
export function ranking(g: MemoryGame): Array<{ id: string; points: number; place: number }> {
  const survival = (p: PlayerState) => (p.out ? p.outRound! : g.cfg.maxRounds + 1);
  const key = new Map(g.players.map((p) => [p.id, survival(p) * 1_000_000 + p.points]));
  return placings(key).map((r) => ({ id: r.playerId, points: player(g, r.playerId)!.points, place: r.place }));
}
