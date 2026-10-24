/**
 * Ten-pin scoring, pure. A player's game is just the list of pins knocked down by each ball; everything else
 * (frames, marks, running totals, what the next ball is) is derived from it. `frames` is 10 for a full game;
 * the last frame always follows the 10th-frame rules (a strike or spare there earns the bonus balls).
 */

export interface FrameView {
  /** Pins per ball in this frame (1–3 balls). */
  rolls: number[];
  /** What the score sheet shows per ball: "X", "/", "-" or a digit. */
  marks: string[];
  /** Running total up to and including this frame, or null while bonus balls are still to come. */
  total: number | null;
  strike: boolean;
  spare: boolean;
}

export interface NextBall {
  /** The frame the next ball belongs to (0-based), or -1 when the game is complete. */
  frame: number;
  /** Ball number within that frame (0-based). */
  ball: number;
  /** True when the next ball is thrown at a fresh rack of 10 pins. */
  freshRack: boolean;
  /** Pins standing for the next ball (10 on a fresh rack). */
  standing: number;
}

const mark = (pins: number, prev: number | null, freshBefore: boolean): string => {
  if (freshBefore && pins === 10) return "X";
  if (!freshBefore && prev !== null && prev + pins === 10) return "/";
  return pins === 0 ? "-" : String(pins);
};

/** Splits the rolls into frames and computes the running totals. */
export function scoreFrames(rolls: number[], frames = 10): FrameView[] {
  const out: FrameView[] = [];
  let i = 0;
  let running = 0;
  for (let f = 0; f < frames && i < rolls.length; f++) {
    const last = f === frames - 1;
    const start = i;
    const r1 = rolls[i]!;
    let fr: number[];
    if (!last) {
      if (r1 === 10) fr = [10];
      else fr = rolls.slice(i, i + 2);
      i += fr.length;
    } else {
      fr = rolls.slice(i, i + 3);
      const r2 = fr[1];
      if (fr.length >= 2 && r1 < 10 && r1 + r2! < 10) fr = fr.slice(0, 2); // open final frame: two balls
      i += fr.length;
    }
    const strike = r1 === 10;
    const spare = !strike && fr.length >= 2 && fr[0]! + fr[1]! === 10;
    // marks, tracking whether each ball faced a fresh rack (matters only in the last frame)
    const marks: string[] = [];
    let fresh = true;
    let prev: number | null = null;
    let left = 10;
    for (const p of fr) {
      marks.push(mark(p, prev, fresh));
      left -= p;
      if (left === 0) { left = 10; fresh = true; prev = null; } else { fresh = false; prev = p; }
    }
    // the total is known once the frame and its bonus balls have been thrown
    let total: number | null = null;
    if (!last) {
      const need = strike ? 3 : spare ? 3 : 2;
      const window = rolls.slice(start, start + need);
      if (fr.length === (strike ? 1 : 2) && window.length === need) total = running + window.reduce((a, b) => a + b, 0);
    } else {
      const complete = (strike || spare) ? fr.length === 3 : fr.length === 2;
      if (complete) total = running + fr.reduce((a, b) => a + b, 0);
    }
    if (total !== null) running = total;
    out.push({ rolls: fr, marks, total, strike, spare });
  }
  // a frame after one with a pending total must not show a total
  let pending = false;
  for (const fv of out) {
    if (pending) fv.total = null;
    if (fv.total === null) pending = true;
  }
  return out;
}

/** The latest known running total (0 before the first complete frame). */
export function totalScore(rolls: number[], frames = 10): number {
  let t = 0;
  for (const f of scoreFrames(rolls, frames)) if (f.total !== null) t = f.total;
  return t;
}

/** What the next ball is for a player with these rolls. */
export function nextBall(rolls: number[], frames = 10): NextBall {
  const fv = scoreFrames(rolls, frames);
  const lastIdx = frames - 1;
  if (fv.length === 0) return { frame: 0, ball: 0, freshRack: true, standing: 10 };
  const cur = fv[fv.length - 1]!;
  const f = fv.length - 1;
  if (f < lastIdx) {
    const done = cur.strike || cur.rolls.length === 2;
    if (done) return { frame: f + 1, ball: 0, freshRack: true, standing: 10 };
    return { frame: f, ball: 1, freshRack: false, standing: 10 - cur.rolls[0]! };
  }
  // final frame
  const r = cur.rolls;
  if (r.length === 1) return r[0] === 10 ? { frame: f, ball: 1, freshRack: true, standing: 10 } : { frame: f, ball: 1, freshRack: false, standing: 10 - r[0]! };
  if (r.length === 2) {
    if (r[0] === 10) return r[1] === 10 ? { frame: f, ball: 2, freshRack: true, standing: 10 } : { frame: f, ball: 2, freshRack: false, standing: 10 - r[1]! };
    if (r[0]! + r[1]! === 10) return { frame: f, ball: 2, freshRack: true, standing: 10 };
  }
  return { frame: -1, ball: 0, freshRack: false, standing: 0 };
}

export function isComplete(rolls: number[], frames = 10): boolean {
  return nextBall(rolls, frames).frame === -1;
}

/** Number of frames this player has finished. */
export function framesDone(rolls: number[], frames = 10): number {
  const nb = nextBall(rolls, frames);
  return nb.frame === -1 ? frames : nb.frame;
}

/** How a ball's result is announced. */
export function callout(pinsThisBall: number, standingBefore: number, freshRack: boolean): string {
  if (freshRack && pinsThisBall === 10) return "STRIKE!";
  if (!freshRack && pinsThisBall === standingBefore) return "SPARE!";
  if (pinsThisBall === 0) return standingBefore === 10 ? "Gutter ball" : "Missed";
  return `${pinsThisBall} pin${pinsThisBall === 1 ? "" : "s"}`;
}
