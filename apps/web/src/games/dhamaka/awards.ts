import type { Game, Player } from "./engine";

/** Funny finale awards, each to one player. Ids match the strings in ./strings.ts. */
export type AwardId = "fastest" | "steal" | "whisperer" | "fire" | "gambler" | "brave";
export interface Award { id: AwardId; playerId: string; value: number }

const best = (ps: Player[], score: (p: Player) => number, ok: (v: number) => boolean, low = false): { p: Player; v: number } | null => {
  let out: { p: Player; v: number } | null = null;
  for (const p of ps) {
    const v = score(p);
    if (!ok(v)) continue;
    if (!out || (low ? v < out.v : v > out.v)) out = { p, v };
  }
  return out;
};

/** Up to four awards, the most impressive first; a player can win several. */
export function awards(g: Game, max = 4): Award[] {
  const ps = g.players;
  const picks: Array<[AwardId, { p: Player; v: number } | null]> = [
    ["fastest", best(ps, (p) => p.stats.fastestMs, Number.isFinite, true)],
    ["steal", best(ps, (p) => p.stats.steals, (v) => v >= 1)],
    ["whisperer", best(ps, (p) => p.stats.fewestEmojis, (v) => v <= 2, true)],
    ["fire", best(ps, (p) => p.stats.bestStreak, (v) => v >= 3)],
    ["gambler", best(ps, (p) => p.stats.bigWager, (v) => v > 0)],
    ["brave", best(ps, (p) => p.stats.wrongBuzzes, (v) => v >= 2)],
  ];
  return picks.filter(([, w]) => w).slice(0, max).map(([id, w]) => ({ id, playerId: w!.p.id, value: w!.v }));
}
