/**
 * Funny end-of-match awards for the podium. Each award goes to the fighter with the best stat for it (ties:
 * the earlier slot); the champion award always comes first, and later awards prefer someone without one yet,
 * so as many players as possible get a moment.
 */
import { standings } from "./engine";
import type { Fighter, Match, Stats } from "./rules";

export interface Award { id: string; title: string; emoji: string; playerId: string; detail: string }

interface Kind { id: string; title: string; emoji: string; value(s: Stats): number; detail(s: Stats): string; min: number }

const KINDS: Kind[] = [
  { id: "feathers", title: "Most Feathers", emoji: "🪶", value: (s) => s.feathers, detail: (s) => `${s.feathers} feathers knocked loose`, min: 1 },
  { id: "first-off", title: "Fell Off First", emoji: "🙃", value: (s) => s.firstOuts, detail: (s) => (s.firstOuts > 1 ? `first off the bed ${s.firstOuts} times` : "first one off the bed"), min: 1 },
  { id: "comeback", title: "Comeback Kid", emoji: "🔥", value: (s) => s.comebacks, detail: () => "won a round from behind", min: 1 },
  { id: "smash", title: "Biggest Smash", emoji: "💥", value: (s) => s.bestHit, detail: (s) => `launch speed ${Math.round(s.bestHit)}`, min: 10 },
  { id: "ghost", title: "Sneakiest Ghost", emoji: "👻", value: (s) => s.slipsCaused * 3 + s.hazards, detail: (s) => (s.slipsCaused ? `${s.slipsCaused} sock slips` : `${s.hazards} hazards dropped`), min: 1 },
  { id: "dodge", title: "Dodge Master", emoji: "💨", value: (s) => s.dodges, detail: (s) => `${s.dodges} dodges`, min: 3 },
  { id: "kos", title: "Knockout King", emoji: "🥊", value: (s) => s.kos, detail: (s) => `${s.kos} knockouts`, min: 2 },
];

function best(fs: Fighter[], k: Kind, avoid: Set<string>): Fighter | null {
  const ok = fs.filter((f) => k.value(f.stats) >= k.min);
  if (!ok.length) return null;
  const top = Math.max(...ok.map((f) => k.value(f.stats)));
  const tied = ok.filter((f) => k.value(f.stats) === top);
  return tied.find((f) => !avoid.has(f.id)) ?? tied[0]!;
}

/** Up to `max` awards: the champion, then the funniest stats. */
export function awards(m: Match, max = 4): Award[] {
  const out: Award[] = [];
  const got = new Set<string>();
  const champ = m.matchWinner ? m.fighters.find((f) => f.id === m.matchWinner) : standings(m)[0];
  if (champ) {
    const w = champ.stats.roundWins;
    out.push({ id: "champion", title: "Pillow Champion", emoji: "👑", playerId: champ.id, detail: `${w} round${w === 1 ? "" : "s"} won` });
    got.add(champ.id);
  }
  // first pass: awards for players who have none yet; second pass: any leftover awards
  for (const pass of [0, 1]) {
    for (const k of KINDS) {
      if (out.length >= max || out.some((a) => a.id === k.id)) continue;
      const f = best(m.fighters, k, got);
      if (!f || (pass === 0 && got.has(f.id))) continue;
      out.push({ id: k.id, title: k.title, emoji: k.emoji, playerId: f.id, detail: k.detail(f.stats) });
      got.add(f.id);
    }
  }
  return out;
}
