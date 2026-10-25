/**
 * kitplat/game: what a platformer built on the kit declares (PlatGameDef), and the funny end-of-game awards
 * every game shares (each game words them its own way).
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { GameSpec, Hero, HeroStats, Mode } from "./types";

export type Theme = "monsoon" | "festival" | "stepwell";

export interface AwardText { emoji: string; title: string; detail: (n: number) => string }

export interface PlatGameDef {
  spec: GameSpec;
  controls: ControlSpec;
  /** Asset folders: tiles, items, foes and backdrops of the world, and the hero sheet. */
  theme: Theme;
  hero: string;
  title: string;
  emoji: string;
  tagline: string;
  /** Accent colours for the TV screens. */
  colors: [string, string];
  /** Hue (degrees) of the hero's paint that takes each player's colour. */
  keyHue: number;
  /** Power id → sprite drawn over the hero while it is active. */
  overlays: Record<string, string>;
  rain: number;
  /** Mode names as the game calls them, e.g. { coop: "Deliver together", race: "Courier race" }. */
  modeNames: Record<Mode, string>;
  modeBlurbs: Record<Mode, string>;
  podiumTitle: string;
  winText: string;
  /** Award wording per stat (keys of HeroStats, plus "score"). */
  awards: Partial<Record<keyof HeroStats | "score", AwardText>>;
}

export interface Award { emoji: string; title: string; detail: string; slot: number }

/** Picks up to five awards: the top scorer, then the most remarkable stats, preferring different heroes. */
export function pickAwards(def: Pick<PlatGameDef, "awards">, heroes: Hero[]): Award[] {
  const out: Award[] = [];
  const order: Array<[keyof HeroStats | "score", number]> = [
    ["score", 1], ["bossHits", 1], ["stomps", 3], ["gems", 8], ["falls", 2], ["revives", 1], ["topSpeed", 11], ["jumps", 15], ["bonks", 2],
    ["crates", 2], ["levers", 2], ["loops", 1], ["kicks", 1], ["powers", 2], ["airTime", 20],
  ];
  const used = new Map<number, number>();
  for (const [stat, min] of order) {
    const text = def.awards[stat];
    if (!text) continue;
    const val = (h: Hero) => (stat === "score" ? h.score : h.stats[stat]);
    let best: Hero | null = null;
    for (const h of heroes) {
      const v = val(h);
      if (v < min) continue;
      if (!best || v > val(best) || (v === val(best) && (used.get(h.slot) ?? 0) < (used.get(best.slot) ?? 0))) best = h;
    }
    if (!best) continue;
    if ((used.get(best.slot) ?? 0) >= 2 && heroes.length > 1) continue;
    used.set(best.slot, (used.get(best.slot) ?? 0) + 1);
    out.push({ emoji: text.emoji, title: text.title, detail: text.detail(Math.round(val(best))), slot: best.slot });
    if (out.length >= 5) break;
  }
  return out;
}
