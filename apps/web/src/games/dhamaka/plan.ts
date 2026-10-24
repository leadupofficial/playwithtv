import type { QCategory, QLang, QRegion, QType, Question } from "../../content/trivia/types";
import { QUESTIONS, playableIn } from "../../content/trivia/packs";

/** Round kinds: emoji = buzz-in puzzle; mcq = everyone answers; order = sort four films; final = wager + question. */
export type Kind = "emoji" | "mcq" | "order" | "final";

export interface Round {
  kind: Kind;
  q: Question;
  /** display position → answer index (answers are shuffled per round) */
  order: number[];
}

/** 21 rounds plus the final, about 6–7 minutes of play; emoji rounds lead, fact rounds break them up. */
export const NORMAL_PLAN: Kind[] = [
  "emoji", "emoji", "mcq", "emoji", "order", "emoji", "mcq", "emoji", "emoji", "mcq", "emoji",
  "emoji", "mcq", "order", "emoji", "mcq", "emoji", "emoji", "mcq", "emoji", "emoji", "final",
];
/** ?quick=1: about a minute. */
export const QUICK_PLAN: Kind[] = ["emoji", "mcq", "emoji", "order", "final"];

/** Which categories the fact rounds cycle through. */
const MCQ_CATEGORIES: QCategory[][] = [["movies"], ["general", "music"], ["sports"], ["movies", "general"]];
const FINAL_CATEGORIES: QCategory[] = ["general", "sports", "movies", "music"];

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

export function shuffle<T>(a: T[], rand: () => number): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [x[i], x[j]] = [x[j]!, x[i]!];
  }
  return x;
}

const PREFERRED: Record<QLang, QRegion[]> = { en: ["tn", "pan-india", "global"], ta: ["tn"], hi: ["pan-india", "global"] };
const DIFF = { easy: 0, medium: 1, hard: 2 };

/**
 * Picks the questions for one match. Questions playable in the room language come first, with the room's
 * regions preferred (Tamil rooms get more Tamil cinema); English questions fill any gap.
 */
export function makePlan(kinds: Kind[], lang: QLang, rand: () => number, bank: Question[] = QUESTIONS): Round[] {
  const used = new Set<string>();
  const rank = (q: Question) => rand() + (playableIn(q, lang) ? 0 : 10) + (q.regions.some((r) => PREFERRED[lang].includes(r)) ? 0 : 0.7);
  const pick = (types: QType[], cats?: QCategory[], easyFirst = false): Question => {
    const ok = (q: Question) => !used.has(q.id) && types.includes(q.type) && (!cats || cats.includes(q.category)) && playableIn(q, "en");
    let cands = bank.filter(ok);
    if (!cands.length) cands = bank.filter((q) => !used.has(q.id) && types.includes(q.type));
    if (!cands.length) throw new Error(`no ${types.join("/")} questions left`);
    const scored = cands.map((q) => ({ q, k: rank(q) + (easyFirst ? DIFF[q.difficulty] * 0.5 : 0) }));
    scored.sort((a, b) => a.k - b.k);
    const q = scored[0]!.q;
    used.add(q.id);
    return q;
  };
  let mcq = 0;
  let emoji = 0;
  return kinds.map((kind) => {
    let q: Question;
    if (kind === "emoji") q = pick(["emoji"], undefined, emoji++ < 3);
    else if (kind === "order") q = pick(["order"]);
    else if (kind === "mcq") q = pick(["mcq", "number"], MCQ_CATEGORIES[mcq++ % MCQ_CATEGORIES.length]);
    else q = pick(["mcq"], FINAL_CATEGORIES);
    return { kind, q, order: shuffle([0, 1, 2, 3], rand) };
  });
}

/** Display position of the right answer (mcq, emoji, final). */
export function correctPos(r: Round): number {
  return r.order.indexOf(r.q.correct as number);
}

/** The right sequence of display positions (order rounds). */
export function correctSeq(r: Round): number[] {
  return (r.q.correct as number[]).map((a) => r.order.indexOf(a));
}
