/**
 * kitcouple: the shared rules of the couples games (Two Paths, Mind Match, Lantern Truths). Pure, no React,
 * so every rule is unit-tested.
 *
 * A chapter is a run of cards. Every card is played the same way: the players pick on their own phones
 * (nobody sees the other's pick), the TV reveals, either player taps ▶ Next. Matching picks, right guesses
 * and completed dares fill the heart meter, which sets the chapter's stars.
 *
 * Consent rules, baked in here and tested: either player can pass any truth or dare at any time, passing
 * never costs anything, and the 18+ chapter only plays after BOTH players confirm their age (Shell.tsx).
 */
import type { Reward } from "../kitgrid/types";

export type Tone = "sweet" | "silly" | "deep" | "spicy";

export type Card =
  /** Both secretly pick one of two; the same pick fills a heart. */
  | { kind: "pick"; tone: Tone; prompt: string; options: [string, string] }
  /** The subject secretly picks their honest answer, the partner guesses it. `{S}` = the subject's name. */
  | { kind: "guess"; tone: Tone; prompt: string; options: string[] }
  /** The actor chooses Truth or Dare. `{P}` = the partner's name. */
  | { kind: "lantern"; tone: Tone; truth: string; dare: string };

export interface Chapter {
  name: string;
  emoji: string;
  tones: Tone[];
  /** The adults-only chapter: hidden behind the age check, never needed for progress or rewards. */
  spicy?: boolean;
}

/** One relationship journey shared by every couples game; each title tells its own story per chapter. */
export const CHAPTERS: Chapter[] = [
  { name: "First Date", emoji: "🌹", tones: ["sweet"] },
  { name: "Road Trip", emoji: "🚗", tones: ["silly"] },
  { name: "Rainy Night In", emoji: "🌧️", tones: ["deep"] },
  { name: "Anniversary", emoji: "🥂", tones: ["sweet", "silly", "deep"] },
  { name: "After Dark", emoji: "🌶️", tones: ["spicy"], spicy: true },
];
export const SPICY = CHAPTERS.findIndex((c) => c.spicy);
export const ROUNDS = 8;

export interface CoupleTitle {
  id: string;
  name: string;
  emoji: string;
  /** One line under the title on the chapter screen. */
  tagline: string;
  /** What to do, shown before the first card. */
  howTo: string;
  cards: Card[];
  /** The story card for each chapter (same order as CHAPTERS). */
  stories: string[];
  rewards: Reward[];
  /** CSS backgrounds: "" is the default, other keys are theme reward ids. */
  themes: Record<string, string>;
}

/** The playable chapters: the next one opens when the one before it has a star; After Dark is always listed. */
export const chapterOpen = (stars: number[], i: number) => CHAPTERS[i]!.spicy || i === 0 || (stars[i - 1] ?? 0) > 0;

export type Round = Card & { actor: 0 | 1 };

/** Deals a chapter: cards of the chapter's tones, not seen yet this session, actors taking turns. */
export function deal(cards: Card[], chapter: number, rand: () => number, used: Set<Card>, quick = false): Round[] {
  const tones = CHAPTERS[chapter]!.tones;
  const pool = cards.filter((c) => tones.includes(c.tone));
  let fresh = pool.filter((c) => !used.has(c));
  const n = quick ? 2 : ROUNDS;
  if (fresh.length < n) {
    for (const c of pool) used.delete(c); // the deck ran out: shuffle it back in
    fresh = pool.slice();
  }
  const picked: Card[] = [];
  while (picked.length < n && fresh.length) picked.push(fresh.splice(Math.floor(rand() * fresh.length), 1)[0]!);
  for (const c of picked) used.add(c);
  const first = rand() < 0.5 ? 0 : 1;
  return picked.map((c, i) => ({ ...c, actor: ((first + i) % 2) as 0 | 1 }));
}

export type Action = "o0" | "o1" | "o2" | "o3" | "pass";
export type Step = "ask" | "card" | "reveal" | "done";
export interface MatchEvent { to: 0 | 1 | "both"; toast?: string; tone?: "good" | "bad" | "info"; sfx?: "select" | "star" | "clear" | "move" | "back"; buzz?: number }
export interface Check { text: string; ok: boolean }

const LETTER = ["🅰", "🅱", "🅲", "🅳"];
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One chapter being played by two players (0 and 1). */
export class CoupleMatch {
  i = 0;
  step: Step = "ask";
  picks: [number | null, number | null] = [null, null];
  /** Lantern: the actor's choice, then how the card ended. */
  choice: "truth" | "dare" | null = null;
  ended: "done" | "pass" | null = null;
  hearts = 0;
  /** Lantern: completed cards per player, and how many truths/dares were completed. */
  doneBy: [number, number] = [0, 0];
  truths = 0;
  dares = 0;
  passes = 0;

  constructor(readonly rounds: Round[], readonly names: [string, string]) {}

  get round(): Round {
    return this.rounds[this.i]!;
  }

  /** Text with the names filled in: `{S}` the subject/actor, `{P}` their partner. */
  fill(text: string): string {
    const a = this.round.actor;
    return text.replaceAll("{S}", this.names[a]).replaceAll("{P}", this.names[1 - a]!);
  }

  /** Whose pick the current step is waiting for. */
  waitingOn(): Array<0 | 1> {
    const r = this.round;
    if (this.step === "ask") {
      if (r.kind === "lantern") return this.choice ? [] : [r.actor];
      return ([0, 1] as const).filter((p) => this.picks[p] === null);
    }
    if (this.step === "card") return [0, 1];
    return [];
  }

  act(who: 0 | 1, action: Action): MatchEvent[] {
    const r = this.round;
    if (this.step === "done") return [];
    if (this.step === "reveal") {
      if (action !== "o0") return [];
      return this.next();
    }
    if (r.kind === "lantern") {
      if (this.step === "ask") {
        if (who !== r.actor || (action !== "o0" && action !== "o1")) return [];
        this.choice = action === "o0" ? "truth" : "dare";
        this.step = "card";
        return [{ to: "both", sfx: "select", buzz: 30 }];
      }
      // card: either player can finish or pass it, no questions asked
      if (action === "o0") {
        this.ended = "done";
        this.hearts++;
        this.doneBy[r.actor]++;
        if (this.choice === "truth") this.truths++;
        else this.dares++;
        this.step = "reveal";
        return [{ to: "both", sfx: "star", toast: "❤ Lovely!", tone: "good", buzz: 60 }];
      }
      if (action === "pass") {
        this.ended = "pass";
        this.passes++;
        this.step = "reveal";
        return [{ to: "both", sfx: "back", toast: "Passed. No problem at all", tone: "info" }];
      }
      return [];
    }
    // pick / guess: each player picks once, in secret
    if (this.picks[who] !== null) return [];
    const n = r.kind === "pick" ? 2 : r.options.length;
    const opt = { o0: 0, o1: 1, o2: 2, o3: 3, pass: -1 }[action];
    if (opt < 0 || opt >= n) return [];
    this.picks[who] = opt;
    const out: MatchEvent[] = [{ to: who, toast: "Locked in 🔒", sfx: "select", buzz: 30 }];
    if (this.picks[0] !== null && this.picks[1] !== null) {
      this.step = "reveal";
      const match = this.picks[0] === this.picks[1];
      if (match) this.hearts++;
      const good = r.kind === "pick" ? "💞 Same path!" : `💞 ${this.names[1 - r.actor]} knows you!`;
      const miss = r.kind === "pick" ? "Opposites attract. Talk it over!" : "Not this time. Tell the story!";
      out.push({ to: "both", toast: match ? good : miss, tone: match ? "good" : "info", sfx: match ? "star" : "move", buzz: match ? 80 : 20 });
    }
    return out;
  }

  private next(): MatchEvent[] {
    if (this.i + 1 >= this.rounds.length) {
      this.step = "done";
      return [{ to: "both", sfx: "clear" }];
    }
    this.i++;
    this.step = "ask";
    this.picks = [null, null];
    this.choice = null;
    this.ended = null;
    return [{ to: "both", sfx: "move" }];
  }

  /** Did this round fill a heart? (reveal step) */
  matched(): boolean {
    return this.round.kind === "lantern" ? this.ended === "done" : this.picks[0] !== null && this.picks[0] === this.picks[1];
  }

  /** The chapter's checklist; each ticked line is a star. Passing a truth or dare never un-ticks anything. */
  checks(): Check[] {
    const done = this.step === "done";
    const lantern = this.rounds.some((r) => r.kind === "lantern");
    if (lantern) {
      return [
        { text: "Open every lantern", ok: done },
        { text: "Both of you complete at least one card", ok: done && this.doneBy[0] > 0 && this.doneBy[1] > 0 },
        { text: "Complete at least one truth and one dare", ok: done && this.truths > 0 && this.dares > 0 },
      ];
    }
    const pct = this.hearts / this.rounds.length;
    return [
      { text: "Play every card", ok: done },
      { text: "Fill half the heart meter", ok: done && pct >= 0.5 },
      { text: "Fill three quarters of the heart meter", ok: done && pct >= 0.75 },
    ];
  }

  stars(): number {
    return this.checks().filter((c) => c.ok).length;
  }

  /** What each phone's buttons say right now ("" hides a button). */
  labels(who: 0 | 1): Record<Action, string> {
    const none: Record<Action, string> = { o0: "", o1: "", o2: "", o3: "", pass: "" };
    const r = this.round;
    if (this.step === "reveal") return { ...none, o0: "▶ Next" };
    if (this.step === "done") return none;
    if (r.kind === "lantern") {
      if (this.step === "card") return { ...none, o0: "✅ Done!", pass: "🙅 Pass" };
      return who === r.actor && !this.choice ? { ...none, o0: "💬 Truth", o1: "🔥 Dare" } : none;
    }
    if (this.picks[who] !== null) return none;
    const opts = r.kind === "pick" ? r.options : r.options;
    const out = { ...none };
    opts.forEach((o, k) => (out[`o${k}` as Action] = `${LETTER[k]} ${short(o)}`));
    return out;
  }

  /** The line above each phone's buttons. */
  status(who: 0 | 1): string {
    const r = this.round;
    const other = this.names[1 - who]!;
    if (this.step === "reveal") return "Tap ▶ Next when you're ready";
    if (r.kind === "lantern") {
      if (this.step === "card") return who === r.actor ? "Your card is on the TV. ✅ when done, or pass" : `${this.names[r.actor]}'s card is on the TV. ✅ when done, or pass`;
      return who === r.actor ? "Truth or dare? Pick a lantern" : `${this.names[r.actor]} is picking a lantern…`;
    }
    if (this.picks[who] !== null) return `Locked in 🔒 Waiting for ${other}…`;
    if (r.kind === "guess") return who === r.actor ? "Pick YOUR honest answer (secret)" : `Guess ${this.names[r.actor]}'s answer (secret)`;
    return "Pick your path (secret)";
  }
}
