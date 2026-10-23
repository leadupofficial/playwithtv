import type { GameResult } from "@playwithtv/protocol";

/** Standard competition ranking, highest score first: equal scores share a place (1, 2, 2, 4). */
export function placings(scores: Map<string, number>): GameResult[] {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const out: GameResult[] = [];
  sorted.forEach(([playerId, score], i) => {
    const prev = out[i - 1];
    const place = prev && sorted[i - 1]![1] === score ? prev.place : i + 1;
    out.push({ playerId, score, place });
  });
  return out;
}
