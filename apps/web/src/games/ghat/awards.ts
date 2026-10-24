/**
 * Podium awards: one funny title per stand-out stat, each to a different racer where possible (so more people
 * get a moment), humans first on ties. Pure.
 */
import type { Racer } from "./racer";

export interface Award { id: string; emoji: string; title: string; detail: string }

interface Rule { emoji: string; title: string; score: (r: Racer) => number; detail: (r: Racer) => string; min: number }

const RULES: Rule[] = [
  { emoji: "💥", title: "Takedown Tycoon", score: (r) => r.stats.takedowns, detail: (r) => `${r.stats.takedowns} takedown${r.stats.takedowns === 1 ? "" : "s"}`, min: 1 },
  { emoji: "🐐", title: "Goat Whisperer", score: (r) => r.stats.goatDodges + r.stats.goatHits * 2, detail: (r) => r.stats.goatHits ? `bumped ${r.stats.goatHits} goat${r.stats.goatHits === 1 ? "" : "s"} (they're fine)` : `${r.stats.goatDodges} goat dodges`, min: 1 },
  { emoji: "😮‍💨", title: "Near-Miss Ninja", score: (r) => r.stats.nearMisses, detail: (r) => `${r.stats.nearMisses} near misses`, min: 2 },
  { emoji: "🦅", title: "Frequent Flyer", score: (r) => r.stats.air, detail: (r) => `${r.stats.air.toFixed(1)} s in the air`, min: 1.2 },
  { emoji: "🟣", title: "Spark Plug", score: (r) => r.stats.turbos[2] * 3 + r.stats.turbos[1], detail: (r) => `${r.stats.turbos[2]} purple turbos`, min: 2 },
  { emoji: "🧱", title: "Wall Hugger", score: (r) => r.stats.rails, detail: (r) => `scraped the rails ${r.stats.rails} times`, min: 6 },
  { emoji: "☕", title: "Chai Addict", score: (r) => r.stats.boosts + r.stats.items, detail: (r) => `${r.stats.boosts} boosts, ${r.stats.items} items`, min: 3 },
  { emoji: "🚑", title: "Most Wrecked", score: (r) => r.stats.wrecked + r.stats.crashes, detail: (r) => `wrecked ${r.stats.wrecked + r.stats.crashes} times, still smiling`, min: 2 },
  { emoji: "🌧️", title: "Monsoon Survivor", score: (r) => r.place, detail: () => "finished, soaked", min: 4 },
];

/** Picks up to `max` awards. Racers listed in `prefer` (humans) win ties. */
export function pickAwards(racers: Racer[], max = 4, prefer: Set<string> = new Set()): Award[] {
  const out: Award[] = [];
  const used = new Set<string>();
  for (const rule of RULES) {
    if (out.length >= max) break;
    const ranked = racers
      .filter((r) => rule.score(r) >= rule.min)
      .sort((a, b) => rule.score(b) - rule.score(a) || (prefer.has(b.id) ? 1 : 0) - (prefer.has(a.id) ? 1 : 0));
    const pick = ranked.find((r) => !used.has(r.id)) ?? null;
    if (!pick) continue;
    used.add(pick.id);
    out.push({ id: pick.id, emoji: rule.emoji, title: rule.title, detail: rule.detail(pick) });
  }
  return out;
}

/** Final score for placings(): better places score higher; ties are impossible (finish order is strict). */
export function raceScore(place: number, field: number): number {
  return (field - place + 1) * 10;
}
