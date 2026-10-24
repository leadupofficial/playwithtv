import { placings } from "../scoring";

/**
 * The shoot-out format, pure. Fairest for a party: every round, each player takes one kick against the next
 * player in the order as keeper, so everyone kicks and keeps exactly once per round and nobody waits long.
 *
 *   1 player   you against a CPU team: you kick against the CPU keeper, then keep against the CPU kicker
 *              (a classic shoot-out, decided early once one side can't catch up)
 *   2+ players everyone for themselves: A kicks at B, B at C, …, the last at A; most goals wins
 *
 * After the regular kicks, the players level on the most goals go to sudden death: one more kick each per
 * round until one of them is ahead at the end of a round (shared win after `maxSudden` rounds).
 */
export const CPU = "cpu";

export interface MatchConfig { regular: number; maxSudden: number }
export const NORMAL_MATCH: MatchConfig = { regular: 5, maxSudden: 5 };
export const QUICK_MATCH: MatchConfig = { regular: 2, maxSudden: 2 };

export interface Pairing { kicker: string; keeper: string }

export interface Match {
  cfg: MatchConfig;
  /** Everyone taking kicks, in order (the CPU team is last in a solo game). */
  takers: string[];
  solo: boolean;
  phase: "regular" | "sudden" | "over";
  /** Regular round (0-based) or sudden-death round. */
  round: number;
  queue: Pairing[];
  index: number;
  goals: Record<string, number>;
  /** Every kick's result per taker, in order (true = goal), for the scoreboard. */
  kicks: Record<string, boolean[]>;
  /** Who is still in it (everyone during regular kicks; the tied leaders in sudden death). */
  contenders: string[];
  winners: string[];
}

export function pairings(order: string[]): Pairing[] {
  return order.map((kicker, i) => ({ kicker, keeper: order[(i + 1) % order.length]! }));
}

export function newMatch(ids: string[], cfg: MatchConfig = NORMAL_MATCH): Match {
  const solo = ids.length === 1;
  const takers = solo ? [ids[0]!, CPU] : [...ids];
  return {
    cfg, takers, solo, phase: "regular", round: 0, queue: pairings(takers), index: 0,
    goals: Object.fromEntries(takers.map((id) => [id, 0])),
    kicks: Object.fromEntries(takers.map((id) => [id, []])),
    contenders: [...takers], winners: [],
  };
}

/** Who kicks and who keeps next, or null when the match is over. */
export function current(m: Match): Pairing | null {
  return m.phase === "over" ? null : m.queue[m.index] ?? null;
}

const leaders = (m: Match, among: string[]) => {
  const best = Math.max(...among.map((id) => m.goals[id] ?? 0));
  return among.filter((id) => m.goals[id] === best);
};

function finish(m: Match) {
  m.phase = "over";
  m.winners = leaders(m, m.contenders);
}

/** Solo only: one side is so far ahead that the other can't catch up with the kicks left. */
export function decided(m: Match): boolean {
  if (!m.solo || m.phase !== "regular") return false;
  const [a, b] = m.takers as [string, string];
  const left = (id: string) => m.cfg.regular - m.kicks[id]!.length;
  return m.goals[a]! > m.goals[b]! + left(b) || m.goals[b]! > m.goals[a]! + left(a);
}

/** Records the current kick and moves on (to the next kick, the next round, sudden death or the end). */
export function record(m: Match, scored: boolean): void {
  const p = current(m);
  if (!p) return;
  m.kicks[p.kicker]!.push(scored);
  if (scored) m.goals[p.kicker]!++;
  m.index++;
  if (decided(m)) return finish(m);
  if (m.index < m.queue.length) return;
  m.index = 0;
  m.round++;
  if (m.phase === "regular") {
    if (m.round < m.cfg.regular) {
      m.queue = pairings(m.takers);
      return;
    }
    const top = leaders(m, m.takers);
    m.contenders = top;
    if (top.length === 1) return finish(m);
    m.phase = "sudden";
    m.round = 0;
    m.queue = pairings(top);
    return;
  }
  // sudden death: whoever scored this round stays in (if nobody did, everyone does)
  m.contenders = leaders(m, m.contenders);
  if (m.contenders.length === 1 || m.round >= m.cfg.maxSudden) return finish(m);
  m.queue = pairings(m.contenders);
}

/** Final places for the human players (games/scoring.ts ranking by goals; the CPU team counts as a rival). */
export function results(m: Match): Array<{ playerId: string; score: number; place: number }> {
  const goals = new Map(m.takers.map((id) => [id, m.goals[id]!]));
  // sudden-death winners are always ahead on goals; a shared win after the last round keeps equal goals
  return placings(goals).filter((r) => r.playerId !== CPU);
}
