import { correctPos, correctSeq, type Round } from "./plan";
import {
  STEAL_FIRST, STEAL_LATE, WRONG_BUZZ, NO_BUZZ_MAX, ORDER_PER_ITEM, emojiPoints, isComeback, orderHits, settleWager,
  speedPoints, streakBonus, wagerPoints, withComeback,
} from "./scoring";

/**
 * Emoji Dhamaka rules as a pure state machine (no React, no DOM, no clocks: the TV calls `tick`).
 *
 *   intro → round-intro → emoji: reveal ─buzz→ answer ─wrong→ steal ─→ result
 *                                       └─nobody buzzed→ all ─→ result
 *                       → mcq / order: all → result
 *   result → (board every 4 rounds) → round-intro … → final: wager → all → result → podium → over
 */
export type Phase = "intro" | "round-intro" | "reveal" | "answer" | "steal" | "all" | "result" | "board" | "wager" | "podium" | "over";

export interface Timing {
  intro: number; roundIntro: number; revealStep: number; revealTail: number; answer: number; steal: number;
  all: number; order: number; result: number; board: number; wager: number; finalQ: number; finalResult: number; podium: number;
}
export const NORMAL: Timing = {
  intro: 8000, roundIntro: 3000, revealStep: 1800, revealTail: 4500, answer: 7000, steal: 6500, all: 13000, order: 18000,
  result: 5000, board: 5500, wager: 12000, finalQ: 15000, finalResult: 8000, podium: 15000,
};
export const QUICK: Timing = {
  intro: 1500, roundIntro: 700, revealStep: 500, revealTail: 3000, answer: 5000, steal: 5000, all: 6000, order: 8000,
  result: 1500, board: 1200, wager: 6000, finalQ: 6000, finalResult: 2000, podium: 3000,
};

export interface Answer { pos: number; seq: number[]; at: number; done: boolean }
export interface PlayerStats { correct: number; steals: number; wrongBuzzes: number; fastestMs: number; fewestEmojis: number; bestStreak: number; bigWager: number }
export interface Player {
  id: string;
  score: number;
  streak: number;
  /** Locked out of the current emoji puzzle (wrong buzz). */
  locked: boolean;
  answer: Answer | null;
  wagerFrac: number;
  wagerLocked: boolean;
  /** Points from the last result (for the floating "+850"). */
  gain: number;
  stats: PlayerStats;
}
export interface Outcome {
  winners: string[];       // got it right this round
  stealer: string | null;
  buzzer: string | null;
  buzzerRight: boolean;
  gains: Record<string, number>;
  comeback: string[];
  streaks: Record<string, number>;
}

export interface Game {
  cfg: Timing;
  rounds: Round[];
  ri: number;
  phase: Phase;
  t: number;
  dur: number;
  /** Emoji clues on screen. */
  revealed: number;
  buzzer: string | null;
  /** When the buzzer buzzed (ms into the reveal). */
  buzzAt: number;
  /** Display positions already ruled out by a wrong buzz. */
  out: number[];
  players: Player[];
  away: Set<string>;
  outcome: Outcome | null;
  /** Scores at the start of the round (for the comeback check). */
  startScores: Record<string, number>;
}

export type GameEvent =
  | { kind: "phase"; phase: Phase }
  | { kind: "reveal"; index: number }
  | { kind: "buzz"; id: string }
  | { kind: "wrong-buzz"; id: string; penalty: number; timeout: boolean }
  | { kind: "steal-open" }
  | { kind: "answered"; id: string }
  | { kind: "result"; outcome: Outcome }
  | { kind: "over" };

const stats = (): PlayerStats => ({ correct: 0, steals: 0, wrongBuzzes: 0, fastestMs: Infinity, fewestEmojis: Infinity, bestStreak: 0, bigWager: 0 });

export function newGame(ids: string[], rounds: Round[], cfg: Timing): Game {
  return {
    cfg, rounds, ri: 0, phase: "intro", t: 0, dur: cfg.intro, revealed: 0, buzzer: null, buzzAt: 0, out: [], away: new Set(), outcome: null, startScores: {},
    players: ids.map((id) => ({ id, score: 0, streak: 0, locked: false, answer: null, wagerFrac: 0.5, wagerLocked: false, gain: 0, stats: stats() })),
  };
}

export const round = (g: Game) => g.rounds[g.ri]!;
export const player = (g: Game, id: string) => g.players.find((p) => p.id === id);
const here = (g: Game) => g.players.filter((p) => !g.away.has(p.id));
const clues = (g: Game) => round(g).q.emoji?.length ?? 0;

/** Players who are not connected right now do not hold up the round. */
export function setAway(g: Game, ids: string[]) {
  g.away = new Set(ids);
}

function enter(g: Game, phase: Phase, dur: number, ev: GameEvent[]) {
  g.phase = phase;
  g.t = 0;
  g.dur = dur;
  ev.push({ kind: "phase", phase });
}

function startRound(g: Game, ev: GameEvent[]) {
  g.buzzer = null;
  g.out = [];
  g.revealed = 0;
  g.outcome = null;
  g.startScores = Object.fromEntries(g.players.map((p) => [p.id, p.score]));
  for (const p of g.players) {
    p.locked = false;
    p.answer = null;
    p.gain = 0;
  }
  enter(g, "round-intro", g.cfg.roundIntro, ev);
}

function openAll(g: Game, ev: GameEvent[]) {
  const r = round(g);
  for (const p of g.players) p.answer = null;
  if (r.kind === "emoji") g.revealed = clues(g);
  enter(g, "all", r.kind === "order" ? g.cfg.order : r.kind === "final" ? g.cfg.finalQ : g.cfg.all, ev);
}

/** Advances the clock by `dt` ms. */
export function tick(g: Game, dt: number): GameEvent[] {
  const ev: GameEvent[] = [];
  if (g.phase === "over") return ev;
  g.t += dt;
  if (g.phase === "reveal") {
    const n = Math.min(clues(g), 1 + Math.floor(g.t / g.cfg.revealStep));
    while (g.revealed < n) ev.push({ kind: "reveal", index: g.revealed++ });
  }
  if (g.t < g.dur) return ev;
  const r = round(g);
  switch (g.phase) {
    case "intro":
      startRound(g, ev);
      break;
    case "round-intro":
      if (r.kind === "emoji") {
        enter(g, "reveal", (clues(g) - 1) * g.cfg.revealStep + g.cfg.revealTail, ev);
        g.revealed = 1;
        ev.push({ kind: "reveal", index: 0 });
      } else if (r.kind === "final") enter(g, "wager", g.cfg.wager, ev);
      else openAll(g, ev);
      break;
    case "reveal":
      openAll(g, ev); // nobody buzzed: everyone answers, for fewer points
      break;
    case "answer":
      wrongBuzz(g, g.buzzer!, -1, true, ev);
      break;
    case "steal":
    case "all":
      settle(g, ev);
      break;
    case "wager":
      for (const p of g.players) p.wagerLocked = true;
      openAll(g, ev);
      break;
    case "result":
      next(g, ev);
      break;
    case "board":
      startRound(g, ev);
      break;
    case "podium":
      g.phase = "over";
      ev.push({ kind: "phase", phase: "over" }, { kind: "over" });
      break;
  }
  return ev;
}

function next(g: Game, ev: GameEvent[]) {
  if (round(g).kind === "final" || g.ri + 1 >= g.rounds.length) return enter(g, "podium", g.cfg.podium, ev);
  g.ri++;
  const board = round(g).kind === "final" || g.ri % 4 === 0;
  if (board) enter(g, "board", g.cfg.board, ev);
  else startRound(g, ev);
}

/** A buzz during the reveal: the first unlocked player gets to answer. */
export function buzz(g: Game, id: string): GameEvent[] {
  const p = player(g, id);
  if (g.phase !== "reveal" || !p || p.locked) return [];
  const ev: GameEvent[] = [{ kind: "buzz", id }];
  g.buzzer = id;
  g.buzzAt = g.t;
  enter(g, "answer", g.cfg.answer, ev);
  return ev;
}

function wrongBuzz(g: Game, id: string, pos: number, timeout: boolean, ev: GameEvent[]) {
  const p = player(g, id)!;
  p.locked = true;
  p.streak = 0;
  p.stats.wrongBuzzes++;
  const penalty = Math.min(p.score, WRONG_BUZZ);
  p.score -= penalty;
  p.gain = -penalty;
  if (pos >= 0) g.out.push(pos);
  ev.push({ kind: "wrong-buzz", id, penalty, timeout });
  if (here(g).some((x) => !x.locked)) {
    g.revealed = clues(g);
    for (const x of g.players) x.answer = null;
    enter(g, "steal", g.cfg.steal, ev);
    ev.push({ kind: "steal-open" });
  } else settle(g, ev);
}

/** A player picks the answer at display position `pos` (order rounds: taps the next film). */
export function answer(g: Game, id: string, pos: number): GameEvent[] {
  const p = player(g, id);
  const ev: GameEvent[] = [];
  if (!p || pos < 0 || pos > 3) return ev;
  const r = round(g);
  if (g.phase === "answer") {
    if (id !== g.buzzer) return ev;
    p.answer = { pos, seq: [], at: g.t, done: true };
    if (pos === correctPos(r)) settle(g, ev);
    else wrongBuzz(g, id, pos, false, ev);
    return ev;
  }
  if (g.phase !== "steal" && g.phase !== "all") return ev;
  if (p.locked || p.answer?.done || g.out.includes(pos)) return ev;
  if (r.kind === "order") {
    const seq = p.answer?.seq ?? [];
    if (seq.includes(pos)) return ev;
    const s = [...seq, pos];
    if (s.length === 3) s.push([0, 1, 2, 3].find((x) => !s.includes(x))!); // the last film is the one left
    p.answer = { pos: -1, seq: s, at: g.t, done: s.length === 4 };
  } else {
    p.answer = { pos, seq: [], at: g.t, done: true };
  }
  if (p.answer.done) ev.push({ kind: "answered", id });
  if (g.phase === "steal" && pos === correctPos(r)) settle(g, ev); // first right steal wins
  else if (here(g).every((x) => x.locked || x.answer?.done)) settle(g, ev);
  return ev;
}

/** Final round: how much of their allowed wager (0..1) a player bets. */
export function setWager(g: Game, id: string, frac: number) {
  const p = player(g, id);
  if (g.phase !== "wager" || !p || p.wagerLocked) return;
  p.wagerFrac = Math.max(0, Math.min(1, frac));
}

export function lockWager(g: Game, id: string): GameEvent[] {
  const p = player(g, id);
  const ev: GameEvent[] = [];
  if (g.phase !== "wager" || !p || p.wagerLocked) return ev;
  p.wagerLocked = true;
  if (here(g).every((x) => x.wagerLocked)) {
    for (const x of g.players) x.wagerLocked = true;
    openAll(g, ev);
  }
  return ev;
}

export const wagerOf = (p: Player) => wagerPoints(p.score, p.wagerFrac);

/** Scores the round and moves to its result. */
function settle(g: Game, ev: GameEvent[]) {
  const r = round(g);
  const leader = Math.max(0, ...Object.values(g.startScores));
  const o: Outcome = { winners: [], stealer: null, buzzer: g.buzzer, buzzerRight: false, gains: {}, comeback: [], streaks: {} };
  const award = (p: Player, base: number, usedMs: number) => {
    const cb = isComeback(g.startScores[p.id] ?? 0, leader);
    p.streak++;
    p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak);
    p.stats.correct++;
    p.stats.fastestMs = Math.min(p.stats.fastestMs, usedMs);
    const pts = withComeback(base, cb) + streakBonus(p.streak);
    p.score += pts;
    p.gain += pts;
    o.winners.push(p.id);
    if (cb) o.comeback.push(p.id);
  };
  const right = correctPos(r);
  if (r.kind === "final") {
    for (const p of g.players) {
      const w = wagerOf(p);
      const ok = p.answer?.pos === right;
      p.stats.bigWager = Math.max(p.stats.bigWager, w);
      const before = p.score;
      p.score = settleWager(p.score, w, ok);
      p.gain = p.score - before;
      if (ok) o.winners.push(p.id);
    }
  } else if (g.phase === "answer" || g.phase === "steal") {
    const b = g.buzzer ? player(g, g.buzzer) : undefined;
    if (b?.answer?.pos === right && !b.locked) {
      o.buzzerRight = true;
      b.stats.fewestEmojis = Math.min(b.stats.fewestEmojis, g.revealed);
      award(b, emojiPoints(g.revealed), g.buzzAt);
    }
    // steal answers in the order they came in: the first right one takes the steal
    const stealers = g.players.filter((p) => p.id !== g.buzzer && p.answer?.done).sort((a, b) => a.answer!.at - b.answer!.at);
    for (const p of stealers) {
      if (p.answer!.pos !== right) {
        p.streak = 0;
        continue;
      }
      const first = !o.stealer;
      if (first) {
        o.stealer = p.id;
        p.stats.steals++;
      }
      award(p, first ? STEAL_FIRST : STEAL_LATE, p.answer!.at);
    }
  } else {
    const max = r.kind === "emoji" ? NO_BUZZ_MAX : undefined;
    for (const p of g.players) {
      if (p.locked) continue;
      const a = p.answer;
      if (r.kind === "order") {
        const hits = a?.done ? orderHits(a.seq, correctSeq(r)) : 0;
        if (hits === 4) award(p, speedPoints(a!.at, g.dur), a!.at);
        else {
          p.streak = 0;
          p.score += hits * ORDER_PER_ITEM;
          p.gain += hits * ORDER_PER_ITEM;
        }
      } else if (a?.done && a.pos === right) award(p, speedPoints(a.at, g.dur, max), a.at);
      else if (!g.away.has(p.id)) p.streak = 0;
    }
  }
  for (const p of g.players) {
    o.gains[p.id] = p.gain;
    o.streaks[p.id] = p.streak;
  }
  g.outcome = o;
  enter(g, "result", r.kind === "final" ? g.cfg.finalResult : g.cfg.result, ev);
  ev.push({ kind: "result", outcome: o });
}

/** Standings, best first (ties keep join order). */
export function standings(g: Game): Player[] {
  return [...g.players].sort((a, b) => b.score - a.score);
}

/** Lets the TV remote skip the intro or a board. */
export function skip(g: Game): GameEvent[] {
  if (g.phase !== "intro" && g.phase !== "board") return [];
  return tick(g, g.dur - g.t);
}
