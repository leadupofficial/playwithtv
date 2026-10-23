import type { ClientMessage } from "@playwithtv/protocol";

type Items = Extract<ClientMessage, { type: "ads.impressions" }>["items"];

const RAIL_ROTATE_MS = 15_000;   // a banner slot shows one sponsor per 15 s
const MAX_RAIL_PER_REPORT = 8;

/**
 * What a TV may claim, judged only by what the server itself saw in that room. A TV reports its own counts,
 * so they are capped here:
 *  - nothing counts from a room nobody has ever joined (a scripted TV with no players shows ads to no one);
 *  - each banner slot can have shown at most one sponsor per 15 s since the last report;
 *  - "presented by" and in-game sponsors appear once per game, so at most once per game the server started.
 * Items are kept in order until a placement's budget is spent.
 */
export function capImpressions(items: Items, playersEverJoined: number, sinceLastMs: number, gamesStarted: number): Items {
  if (playersEverJoined === 0) return [];
  const rails = Math.min(MAX_RAIL_PER_REPORT, Math.max(1, Math.floor(sinceLastMs / RAIL_ROTATE_MS)));
  const budget: Record<string, number> = { "lobby-rail": rails, "results-rail": rails, "presented-by": gamesStarted, "in-game": gamesStarted };
  const out: Items = [];
  for (const it of items) {
    const n = Math.min(it.n, budget[it.placement] ?? 0);
    if (n <= 0) continue;
    budget[it.placement]! -= n;
    out.push({ ...it, n });
  }
  return out;
}

/**
 * Applies a TV's report to its room: null when it came too soon (one report per 20 s), otherwise the capped
 * items, and the room's counters start a new window.
 */
export function takeImpressions(room: { players: { size: number }; lastImpressionsAt: number; gamesSinceReport: number }, items: Items, now = Date.now()): Items | null {
  if (now - room.lastImpressionsAt < 20_000) return null;
  const out = capImpressions(items, room.players.size, now - room.lastImpressionsAt, room.gamesSinceReport);
  room.lastImpressionsAt = now;
  room.gamesSinceReport = 0;
  return out;
}
