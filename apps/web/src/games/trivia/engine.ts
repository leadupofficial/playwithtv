import type { Question } from "./questions";
export { placings } from "../scoring";

export const ROUNDS = 8;
export const QUESTION_MS = 15_000;
export const MAX_POINTS = 1000;

/** A question for one round, with its options shuffled; `correct` is the index into `order`'s display order. */
export interface Round {
  question: Question;
  order: number[];   // display position -> original option index
  correct: number;   // display position of the right answer
}

/** Small seeded PRNG so a match is reproducible in tests. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
}

export function makeRounds(bank: Question[], count: number, rand: () => number): Round[] {
  return shuffle(bank, rand).slice(0, Math.min(count, bank.length)).map((question) => {
    const order = shuffle([0, 1, 2, 3], rand);
    return { question, order, correct: order.indexOf(question.answer) };
  });
}

/** Right answers earn 500 points plus up to 500 for speed; wrong or missing answers earn nothing. */
export function points(correct: boolean, msLeft: number, msTotal = QUESTION_MS): number {
  if (!correct) return 0;
  const f = Math.max(0, Math.min(1, msLeft / msTotal));
  return Math.round(MAX_POINTS / 2 + (MAX_POINTS / 2) * f);
}

