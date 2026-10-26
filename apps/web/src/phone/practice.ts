import type { ControlAction, ControlSpec, GestureName } from "@playwithtv/protocol";

/**
 * "Practice your move": before a motion game the player does the game's main move a few times. The phone watches
 * with the thresholds lowered (PRACTICE_GAIN), so even a gentle move registers, then sets this player's gain so their
 * usual move lands well over the line. Arms and phones differ a lot: on a real phone one player's pushes peaked at
 * 5-11 m/s² and swings at 6-8, against defaults of 11 and 12, so a single global threshold missed most of them.
 */
export const PRACTICE_GAIN = 2.5;
export const PRACTICE_MOVES = 3;
/** The threshold sits at this fraction of the player's typical (median) move: room for a tired or lazy one. */
const MARGIN = 0.6;
const MIN_GAIN = 0.5;
const MAX_GAIN = 2.5;

// moves that need a deliberate, measurable action; shake and the tilt-only games need no practice
const PRACTISED: GestureName[] = ["push", "pull", "swing", "flick-up", "flick-down", "flick-left", "flick-right", "twist-left", "twist-right"];

/** The action to practise: the first one the game fires by a deliberate move. */
export function practiceAction(spec: ControlSpec): ControlAction | null {
  return spec.actions.find((a) => a.gestures?.some((g) => PRACTISED.includes(g))) ?? null;
}

/**
 * The gain from the strengths of the practice moves, as reported at PRACTICE_GAIN (strength = peak / threshold).
 * At gain s the same move would read strength * s / PRACTICE_GAIN; it should read 1 / MARGIN.
 */
export function gainFrom(strengths: number[]): number | null {
  if (strengths.length === 0) return null;
  const xs = [...strengths].sort((a, b) => a - b);
  const median = xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2;
  const g = PRACTICE_GAIN / (median * MARGIN);
  return Math.round(Math.min(MAX_GAIN, Math.max(MIN_GAIN, g)) * 100) / 100;
}

const seen = new Set<string>();
/** Each move is practised once per visit (a game's rounds and phases re-show the pad). */
export function needsPractice(spec: ControlSpec, a: ControlAction) {
  return !seen.has(`${spec.title}/${a.id}`);
}
export function practised(spec: ControlSpec, a: ControlAction) {
  seen.add(`${spec.title}/${a.id}`);
}
