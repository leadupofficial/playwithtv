import { isComplete, nextBall, totalScore } from "./scoring";

/**
 * Whose turn it is in a multi-player game, pure. Players bowl a whole frame each, in order (up to three balls
 * in the last frame), like a real league night.
 */
export interface Match {
  frames: number;
  order: string[];
  rolls: Map<string, number[]>;
  turn: number;
}

export function newMatch(order: string[], frames = 10): Match {
  return { frames, order, rolls: new Map(order.map((id) => [id, []])), turn: 0 };
}

export const bowler = (m: Match) => m.order[m.turn]!;

export function over(m: Match) {
  return m.order.every((id) => isComplete(m.rolls.get(id)!, m.frames));
}

/** The ball the current bowler is about to throw. */
export const upNext = (m: Match) => nextBall(m.rolls.get(bowler(m))!, m.frames);

export interface BallResult {
  /** The next ball (same bowler) is at a fresh rack. */
  freshRack: boolean;
  /** The bowler's frame is over: the turn passes on. */
  turnOver: boolean;
  gameOver: boolean;
}

/** Records the pins knocked down by the current bowler's ball and moves the turn on when their frame ends. */
export function recordBall(m: Match, pins: number): BallResult {
  const id = bowler(m);
  const rolls = m.rolls.get(id)!;
  const before = nextBall(rolls, m.frames);
  rolls.push(Math.max(0, Math.min(before.standing, Math.round(pins))));
  const after = nextBall(rolls, m.frames);
  const turnOver = after.frame !== before.frame;
  if (turnOver && !over(m)) {
    for (let k = 1; k <= m.order.length; k++) {
      const t = (m.turn + k) % m.order.length;
      if (!isComplete(m.rolls.get(m.order[t]!)!, m.frames)) { m.turn = t; break; }
    }
  }
  return { freshRack: turnOver || after.freshRack, turnOver, gameOver: over(m) };
}

export function scores(m: Match): Map<string, number> {
  return new Map(m.order.map((id) => [id, totalScore(m.rolls.get(id)!, m.frames)]));
}
