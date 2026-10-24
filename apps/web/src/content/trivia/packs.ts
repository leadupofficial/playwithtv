import type { Pack, QCategory, QLang, QType, Question, Translation } from "./types";
import { QLANGS } from "./types";
import { playableIn } from "./validate";

/**
 * Every trivia pack in content/trivia, bundled into the app at build time (no runtime fetching).
 * Only approved questions are exposed; a language counts only where its translation is approved.
 */
const files = import.meta.glob<Pack>(["../../../../../content/trivia/*.json", "!**/schema.json"], { eager: true, import: "default" });

export const PACKS: Pack[] = Object.values(files);
export const QUESTIONS: Question[] = PACKS.flatMap((p) => p.questions).filter((q) => q.status === "approved");

export { playableIn };

/** Questions playable in `lang`, optionally limited to some types and categories. */
export function pool(lang: QLang, opts: { types?: QType[]; categories?: QCategory[] } = {}, from: Question[] = QUESTIONS): Question[] {
  return from.filter((q) => playableIn(q, lang) && (!opts.types || opts.types.includes(q.type)) && (!opts.categories || opts.categories.includes(q.category)));
}

/** The text to show for a question in `lang`: that translation when approved, else English. */
export function textOf(q: Question, lang: QLang): { lang: QLang; t: Translation } {
  return playableIn(q, lang) ? { lang, t: q.i18n[lang]! } : { lang: "en", t: q.i18n.en };
}

/** Languages with at least `min[type]` playable questions of each listed type. */
export function offeredLangs(min: Partial<Record<QType, number>>, from: Question[] = QUESTIONS): QLang[] {
  return QLANGS.filter((lang) => Object.entries(min).every(([type, n]) => pool(lang, { types: [type as QType] }, from).length >= (n ?? 0)));
}
