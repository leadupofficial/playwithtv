/**
 * Emoji Dhamaka points. Pure functions, all rounded to tens so the TV shows tidy numbers.
 *
 *   emoji buzz   1000 with one emoji showing, 150 less per extra emoji, never under 400
 *   wrong buzz   −150 (and you are locked out of that puzzle)
 *   steal        500 to the first right answer after a wrong buzz, 100 to later right answers
 *   all-answer   Kahoot-style: half the points for being right, the other half for speed
 *   order        perfect order earns all-answer points; otherwise 100 per film in the right place
 *   streak       +100 per answer in a row after the first, up to +500
 *   comeback     ×1.3 on your base points while you have under half the leader's score
 *   final        double or nothing: right adds your wager, wrong takes it away (never below 0)
 */
export const EMOJI_MAX = 1000;
export const EMOJI_STEP = 150;
export const EMOJI_MIN = 400;
export const WRONG_BUZZ = 150;
export const STEAL_FIRST = 500;
export const STEAL_LATE = 100;
export const ALL_MAX = 1000;
export const NO_BUZZ_MAX = 500;
export const ORDER_PER_ITEM = 100;
export const STREAK_STEP = 100;
export const STREAK_CAP = 5;
export const COMEBACK = 1.3;
/** Players with less than this can still wager up to this much in the final ("house money"). */
export const HOUSE_WAGER = 500;

const tens = (n: number) => Math.round(n / 10) * 10;

/** Points for a right buzz with `revealed` of the clues on screen. */
export function emojiPoints(revealed: number): number {
  return Math.max(EMOJI_MIN, EMOJI_MAX - EMOJI_STEP * Math.max(0, revealed - 1));
}

/** Speed points: half for being right, half scaled by the time left (`usedMs` of `totalMs`). */
export function speedPoints(usedMs: number, totalMs: number, max = ALL_MAX): number {
  const f = Math.max(0, Math.min(1, 1 - usedMs / Math.max(1, totalMs)));
  return tens(max / 2 + (max / 2) * f);
}

/** Order rounds: how many items sit in the right place. */
export function orderHits(seq: number[], correct: number[]): number {
  return correct.reduce((n, c, i) => n + (seq[i] === c ? 1 : 0), 0);
}

export function streakBonus(streak: number): number {
  return streak >= 2 ? STREAK_STEP * Math.min(streak - 1, STREAK_CAP) : 0;
}

/** Trailing players (under half the leader's score) get the comeback boost. */
export function isComeback(score: number, leader: number): boolean {
  return leader > 0 && score < leader / 2;
}

export function withComeback(base: number, comeback: boolean): number {
  return comeback ? tens(base * COMEBACK) : base;
}

/** The most a player may wager in the final. */
export function maxWager(score: number): number {
  return Math.max(score, HOUSE_WAGER);
}

/** A wager fraction (0..1) as points, rounded to tens. */
export function wagerPoints(score: number, frac: number): number {
  return tens(maxWager(score) * Math.max(0, Math.min(1, frac)));
}

/** The final's effect on a score: never below zero. */
export function settleWager(score: number, wager: number, right: boolean): number {
  return Math.max(0, right ? score + wager : score - wager);
}
