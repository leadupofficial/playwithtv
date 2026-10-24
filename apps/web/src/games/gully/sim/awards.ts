/**
 * Podium awards: Gully King (most runs), Window Smasher (broken windows, else the biggest six hitter), Golden Arm
 * (most wickets, fewest runs given), Safe Hands (catches) and Brick Breaker (bowl-out hits). Later awards prefer
 * players without one yet, so more people get a moment.
 */
import type { Match, Stats } from "./match";

export interface Award { id: string; title: string; emoji: string; playerId: string; detail: string }

interface Kind { id: string; title: string; emoji: string; value(s: Stats): number; detail(s: Stats): string; min: number }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const KINDS: Kind[] = [
  { id: "king", title: "Gully King", emoji: "👑", value: (s) => s.runs * 100 + (s.balls ? Math.round((s.runs / s.balls) * 10) : 0), detail: (s) => `${s.runs} runs off ${plural(s.balls, "ball")}`, min: 1 },
  { id: "window", title: "Window Smasher", emoji: "🪟", value: (s) => s.windows * 100 + s.sixes, detail: (s) => (s.windows ? plural(s.windows, "window") + " smashed" : plural(s.sixes, "six") + " out of the gully"), min: 1 },
  { id: "arm", title: "Golden Arm", emoji: "🎯", value: (s) => s.wickets * 100 - s.conceded, detail: (s) => `${plural(s.wickets, "wicket")} for ${s.conceded}`, min: 1 },
  { id: "hands", title: "Safe Hands", emoji: "🧤", value: (s) => s.catches, detail: (s) => plural(s.catches, "catch").replace("catchs", "catches"), min: 1 },
  { id: "bricks", title: "Brick Breaker", emoji: "🧱", value: (s) => s.bowlout, detail: (s) => `hit the bricks ${s.bowlout}×`, min: 1 },
  { id: "timing", title: "Sweet Timing", emoji: "🍯", value: (s) => s.perfects, detail: (s) => plural(s.perfects, "perfect hit"), min: 2 },
];

export function awards(m: Match, max = 4): Award[] {
  const out: Award[] = [];
  const got = new Set<string>();
  const ids = [...m.stats.keys()];
  for (const k of KINDS) {
    if (out.length >= max) break;
    // Golden Arm needs a wicket; others need the stat at all
    const ok = ids.filter((id) => (k.id === "arm" ? m.stats.get(id)!.wickets : k.value(m.stats.get(id)!)) >= k.min);
    if (!ok.length) continue;
    const top = Math.max(...ok.map((id) => k.value(m.stats.get(id)!)));
    const tied = ok.filter((id) => k.value(m.stats.get(id)!) === top);
    const fresh = tied.find((id) => !got.has(id));
    // later awards go to someone new when a tie allows (the king always stands)
    const who = fresh ?? tied[0]!;
    if (k.id !== "king" && got.has(who) && out.length >= 2) continue;
    got.add(who);
    out.push({ id: k.id, title: k.title, emoji: k.emoji, playerId: who, detail: k.detail(m.stats.get(who)!) });
  }
  return out;
}
