/**
 * The trivia question-pack format (content/trivia/*.json, described by content/trivia/schema.json).
 * Any trivia game can use these packs: load them with ./packs.ts, which only ever returns playable questions.
 */
export type QLang = "en" | "ta" | "hi";
export const QLANGS: QLang[] = ["en", "ta", "hi"];

export type QType = "mcq" | "emoji" | "order" | "number";
export type QCategory = "movies" | "music" | "general" | "sports" | "science" | "geography" | "food";
export type QStatus = "approved" | "mt-draft";
export type QRegion = "tn" | "pan-india" | "global";

export interface Translation {
  prompt: string;
  /** The four answers in this language, in the same order as the question's `answers` keys. */
  answers: [string, string, string, string];
  hint?: string;
  /** "mt-draft": this language is not played until a native speaker approves it. */
  status?: QStatus;
}

export interface Question {
  id: string;
  category: QCategory;
  difficulty: "easy" | "medium" | "hard";
  type: QType;
  /** Emoji clues, revealed one at a time (type "emoji" only). Our own encodings. */
  emoji?: string[];
  /** Stable, language-neutral keys for the four answers. */
  answers: [string, string, string, string];
  /** Index of the right answer, or for "order" the answer indices in the right order. */
  correct: number | number[];
  /** Optional fact per answer shown at the reveal (e.g. release years for "order"). */
  values?: number[];
  i18n: Partial<Record<QLang, Translation>> & { en: Translation };
  /** "original" or "wikidata:Q…" (comma-separated for several items). */
  source: string;
  license: "CC0" | "CC-BY-4.0";
  author: string;
  status: QStatus;
  regions: QRegion[];
  tags?: string[];
}

export interface Pack {
  pack: string;
  title: string;
  description?: string;
  questions: Question[];
}
