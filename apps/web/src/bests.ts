import type { GameResult, PlayerView } from "@playwithtv/protocol";

/**
 * Personal bests, kept on this TV (localStorage) per game and per player (name + avatar): no account and nothing
 * sent anywhere. Every game ranks higher scores first, so the best is the highest score.
 */
const key = (gameId: string, p: Pick<PlayerView, "name" | "avatar">) => `pwtv.best.${gameId}.${p.avatar}.${p.name.trim().toLowerCase()}`;

export function readBest(gameId: string, p: Pick<PlayerView, "name" | "avatar">): number | null {
  try {
    const v = localStorage.getItem(key(gameId, p));
    return v === null || !Number.isFinite(Number(v)) ? null : Number(v);
  } catch {
    return null;
  }
}

export interface BestNote { previous: number | null; isNew: boolean }

/** Stores `score` if it beats the stored best. `isNew` is true only when an earlier best was beaten (not on a first game). */
export function recordBest(gameId: string, p: Pick<PlayerView, "name" | "avatar">, score: number): BestNote {
  const previous = readBest(gameId, p);
  const beat = previous === null || score > previous;
  if (beat) {
    try {
      localStorage.setItem(key(gameId, p), String(Math.round(score)));
    } catch { /* storage blocked: no bests, nothing else breaks */ }
  }
  return { previous, isNew: previous !== null && score > previous };
}

/** Records a finished match's results once; returns each player's note for the results screen. */
export function recordResults(gameId: string, results: GameResult[], players: PlayerView[]): Map<string, BestNote> {
  const out = new Map<string, BestNote>();
  for (const r of results) {
    const p = players.find((x) => x.id === r.playerId);
    if (p) out.set(r.playerId, recordBest(gameId, p, r.score));
  }
  return out;
}
