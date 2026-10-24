/**
 * Tiffin Tornado: the funny awards at the end of the trip (pure). Each award goes to the chef with the most of
 * something (ties: the first chef); an award nobody earned is skipped, and a chef gets at most two.
 */
import type { ChefStats } from "./chefs";

export interface Award { id: string; emoji: string; title: string; playerId: string; detail: string }

const AWARDS: Array<{ id: string; emoji: string; title: string; stat: keyof ChefStats; detail: (n: number) => string }> = [
  { id: "maestro", emoji: "🫓", title: "Dosa Maestro", stat: "perfectFlips", detail: (n) => `${n} golden flip${n === 1 ? "" : "s"}` },
  { id: "chutney", emoji: "🥥", title: "Chutney Champ", stat: "chutneys", detail: (n) => `${n} batch${n === 1 ? "" : "es"} ground` },
  { id: "server", emoji: "🛎️", title: "Window Warrior", stat: "serves", detail: (n) => `${n} dish${n === 1 ? "" : "es"} served` },
  { id: "coffee", emoji: "☕", title: "Coffee Wallah", stat: "coffees", detail: (n) => `${n} filter coffee${n === 1 ? "" : "s"}` },
  { id: "fire", emoji: "🧯", title: "Fire Fighter", stat: "doused", detail: (n) => `${n} fire${n === 1 ? "" : "s"} put out` },
  { id: "dishes", emoji: "🧽", title: "Dishwasher Deluxe", stat: "washed", detail: (n) => `${n} plate${n === 1 ? "" : "s"} scrubbed` },
  { id: "drops", emoji: "💥", title: "Most Plates Dropped", stat: "drops", detail: (n) => `${n} plate${n === 1 ? "" : "s"} on the floor` },
  { id: "smoke", emoji: "💨", title: "Smoke Signaller", stat: "burnt", detail: (n) => `${n} thing${n === 1 ? "" : "s"} burnt` },
  { id: "dash", emoji: "🌪️", title: "Human Tornado", stat: "dashes", detail: (n) => `${n} dashes` },
  { id: "chop", emoji: "🔪", title: "Chop Shop", stat: "chops", detail: (n) => `${n} veg chopped` },
];

export function awardsFor(chefs: Array<{ id: string; stats: ChefStats }>, max = 5): Award[] {
  const out: Award[] = [];
  const per = new Map<string, number>();
  for (const a of AWARDS) {
    if (out.length >= max) break;
    let best: { id: string; stats: ChefStats } | null = null;
    for (const c of chefs) {
      if ((per.get(c.id) ?? 0) >= 2) continue;
      if (c.stats[a.stat] > 0 && (!best || c.stats[a.stat] > best.stats[a.stat])) best = c;
    }
    if (!best) continue;
    per.set(best.id, (per.get(best.id) ?? 0) + 1);
    out.push({ id: a.id, emoji: a.emoji, title: a.title, playerId: best.id, detail: a.detail(best.stats[a.stat]) });
  }
  return out;
}
