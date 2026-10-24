import { checkSchema, type Schema } from "./schemaCheck";
import { QLANGS, type Pack, type QLang, type Question } from "./types";

/**
 * Content checks for trivia packs (run by `pnpm content:check` and by the unit tests):
 * schema validity, unique ids, duplicate questions, allowed licences, consistent answers per type,
 * and no media or links of any kind (the repository is public: text only, no posters, audio or lyrics).
 */
export interface PackFile { name: string; data: unknown }
export interface Report {
  errors: string[];
  warnings: string[];
  /** Playable questions per language and type, plus the mt-draft list for native review. */
  stats: { total: number; playable: Record<QLang, Record<string, number>>; drafts: string[]; byCategory: Record<string, number> };
}

export const LICENCES = ["CC0", "CC-BY-4.0"];
const MEDIA_KEYS = /^(image|img|images|audio|video|media|url|urls|href|src|poster|still|photo|thumbnail|lyrics?|sound|clip)$/i;
const LINK = /(https?:\/\/|www\.|data:[a-z]+\/|\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|mp4|webm)\b)/i;
const LETTER = /\p{L}/u;

/** Text a question is matched on for duplicates (case, spacing and punctuation folded). */
const fold = (s: string) => s.toLocaleLowerCase("en").normalize("NFKC").replace(/[\s\p{P}]+/gu, " ").trim();

export function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? [...new Seg("en", { granularity: "grapheme" }).segment(s)].map((x) => x.segment) : [...s];
}

/** Is this question playable in this language? (approved, translated, and that translation not a draft) */
export function playableIn(q: Question, lang: QLang): boolean {
  const t = q.i18n[lang];
  return q.status === "approved" && !!t && t.status !== "mt-draft";
}

function walk(v: unknown, path: string, out: string[]) {
  if (typeof v === "string") {
    if (LINK.test(v)) out.push(`${path}: looks like a link or media file ("${v}")`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (MEDIA_KEYS.test(k)) out.push(`${path}: media/link field "${k}" is not allowed`);
      if (k !== "$schema") walk(x, `${path}.${k}`, out);
    }
  }
}

function checkQuestion(q: Question, at: string, errors: string[], warnings: string[]) {
  const n = q.answers.length;
  if (new Set(q.answers).size !== n) errors.push(`${at}: answer keys repeat`);
  if (q.type === "order") {
    const c = q.correct;
    if (!Array.isArray(c) || [...c].sort().join() !== "0,1,2,3") errors.push(`${at}: an order question needs "correct" as a permutation of 0-3`);
    else if (q.values) {
      const vals = c.map((i) => q.values![i]!);
      if (vals.some((v, i) => i > 0 && v <= vals[i - 1]!)) errors.push(`${at}: "values" do not increase in the "correct" order`);
    }
  } else if (typeof q.correct !== "number") {
    errors.push(`${at}: "correct" must be a single index for ${q.type}`);
  }
  if (q.type === "emoji") {
    if (!q.emoji) errors.push(`${at}: an emoji question needs "emoji" clues`);
    for (const [i, e] of (q.emoji ?? []).entries()) {
      if (LETTER.test(e)) errors.push(`${at}.emoji[${i}]: clues are emoji only, no letters ("${e}")`);
      if (graphemes(e).length > 2) errors.push(`${at}.emoji[${i}]: one emoji per clue ("${e}")`);
    }
  } else if (q.emoji) {
    errors.push(`${at}: only emoji questions have "emoji"`);
  }
  if (q.type === "number") {
    for (const a of q.i18n.en.answers) if (!/^[−-]?\d[\d,.]*$/.test(a)) errors.push(`${at}: number answers must be numbers ("${a}")`);
  }
  if (!LICENCES.includes(q.license)) errors.push(`${at}: licence must be one of ${LICENCES.join(", ")}`);
  for (const lang of QLANGS) {
    const t = q.i18n[lang];
    if (!t) continue;
    const folded = t.answers.map(fold);
    if (new Set(folded).size !== folded.length) errors.push(`${at}.i18n.${lang}: two answers read the same`);
  }
  if (q.i18n.en.status === "mt-draft") errors.push(`${at}: English is the source text and cannot be a draft`);
  if (!q.i18n.ta && !q.i18n.hi) warnings.push(`${at}: English only`);
}

export function validatePacks(schema: Schema, files: PackFile[]): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Map<string, string>();
  const texts = new Map<string, string>();
  const playable = Object.fromEntries(QLANGS.map((l) => [l, {} as Record<string, number>])) as Report["stats"]["playable"];
  const drafts: string[] = [];
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const f of files) {
    const schemaErrs = checkSchema(f.data, schema);
    errors.push(...schemaErrs.map((e) => `${f.name}: ${e}`));
    const media: string[] = [];
    walk(f.data, f.name, media);
    errors.push(...media);
    if (schemaErrs.length) continue; // the checks below rely on the shape
    const pack = f.data as Pack;
    pack.questions.forEach((q, i) => {
      const at = `${f.name}#${q.id ?? i}`;
      total++;
      const prev = ids.get(q.id);
      if (prev) errors.push(`${at}: id "${q.id}" is also used in ${prev}`);
      ids.set(q.id, at);
      const keys = q.type === "emoji"
        ? [`emoji-answer:${q.answers[q.correct as number]}`, `emoji-clues:${(q.emoji ?? []).join("")}`]
        : q.type === "order"
          ? [`order:${[...q.answers].sort().join("|")}`]  // order questions share one prompt: compare the items
          : [`prompt:${fold(q.i18n.en.prompt)}`];
      for (const key of keys) {
        const dup = texts.get(key);
        if (dup) errors.push(`${at}: duplicates ${dup}`);
        texts.set(key, at);
      }
      checkQuestion(q, at, errors, warnings);
      byCategory[q.category] = (byCategory[q.category] ?? 0) + 1;
      for (const lang of QLANGS) {
        if (playableIn(q, lang)) playable[lang][q.type] = (playable[lang][q.type] ?? 0) + 1;
        else if (q.i18n[lang]) drafts.push(`${q.id} [${lang}]`);
      }
    });
  }
  return { errors, warnings, stats: { total, playable, drafts, byCategory } };
}
