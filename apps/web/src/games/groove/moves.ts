/**
 * Groove Party dance moves. Each move is one thing the phone in your right hand can feel (a gesture from
 * @playwithtv/motion), a name and colour for the move card, and the coach's pose for it.
 *
 * The coach faces you like a mirror: the arm on the RIGHT of the screen holds the (imaginary) phone, so when
 * the coach waves to the right of the screen, you wave to your right. "left"/"right" are always yours.
 */
import type { GestureName, SwipeName } from "@playwithtv/protocol";

export type MoveId = "up" | "down" | "punch" | "pull" | "left" | "right" | "twist-l" | "twist-r" | "shimmy";

/**
 * A pose, in the screen's frame. Limb angles are degrees from straight DOWN, turning towards screen-right as
 * they grow (90 = pointing right, 180 = straight up, -90 = pointing left). Upper and lower segments are
 * absolute angles, not relative, so a pose reads like a drawing.
 *   pa/pf: phone arm (screen right) upper/fore · fa/ff: free arm (screen left) upper/fore
 *   pl/fl: legs (thigh angle; the shin follows with a little knee bend) · lean: torso tilt, degrees right
 *   hip: hips shifted right, in torso lengths · drop: knees bent, 0 standing … 0.3 low
 *   reach: phone-arm length (0.6 = pushed towards you, foreshortened) · hand: phone-hand size
 */
export interface Pose {
  pa: number; pf: number; fa: number; ff: number;
  pl: number; fl: number; lean: number; hip: number; drop: number;
  reach: number; hand: number;
}

export interface Move {
  id: MoveId;
  name: string;
  /** What the move card says to do, in a few words. */
  cue: string;
  emoji: string;
  color: string;
  /** The gesture that scores it fully. */
  gesture: GestureName;
  /** A gesture that is the mirror image (left for right): counted, at most GOOD, since people do mirror. */
  mirror?: GestureName;
  /** Touchpad and buttons stand-ins, so anyone can play without motion. */
  swipe: SwipeName | "tap";
  pose: Pose;
}

export const IDLE: Pose = { pa: 18, pf: 8, fa: -18, ff: -8, pl: 8, fl: -8, lean: 0, hip: 0, drop: 0.04, reach: 1, hand: 1 };

export const MOVES: Record<MoveId, Move> = {
  up: {
    id: "up", name: "Reach Up", cue: "phone to the sky", emoji: "🙌", color: "#ffd23f", gesture: "flick-up", swipe: "swipe-up",
    pose: { pa: 168, pf: 176, fa: -150, ff: -170, pl: 6, fl: -6, lean: 0, hip: 0, drop: -0.04, reach: 1, hand: 1.1 },
  },
  down: {
    id: "down", name: "Floor Point", cue: "point to the floor", emoji: "👇", color: "#ff6b6b", gesture: "flick-down", swipe: "swipe-down",
    pose: { pa: 30, pf: 22, fa: -70, ff: -110, pl: 24, fl: -18, lean: 14, hip: 0.05, drop: 0.24, reach: 1, hand: 1.1 },
  },
  punch: {
    id: "punch", name: "Punch", cue: "punch at the TV", emoji: "👊", color: "#ff4fd8", gesture: "push", swipe: "tap",
    pose: { pa: 75, pf: 82, fa: -40, ff: -140, pl: 16, fl: -10, lean: 4, hip: 0, drop: 0.08, reach: 0.62, hand: 1.7 },
  },
  pull: {
    id: "pull", name: "Pull In", cue: "pull it to your chest", emoji: "💪", color: "#9b5cff", gesture: "pull", swipe: "swipe-down",
    pose: { pa: 30, pf: 150, fa: -30, ff: -150, pl: 6, fl: -14, lean: -8, hip: -0.04, drop: 0.06, reach: 1, hand: 1 },
  },
  left: {
    id: "left", name: "Wave Left", cue: "sweep to your left", emoji: "👈", color: "#29d3ff", gesture: "flick-left", mirror: "flick-right", swipe: "swipe-left",
    pose: { pa: -58, pf: -82, fa: -95, ff: -100, pl: 10, fl: -24, lean: -12, hip: -0.1, drop: 0.08, reach: 1, hand: 1.1 },
  },
  right: {
    id: "right", name: "Wave Right", cue: "sweep to your right", emoji: "👉", color: "#3ddc97", gesture: "flick-right", mirror: "flick-left", swipe: "swipe-right",
    pose: { pa: 112, pf: 98, fa: -30, ff: -60, pl: 24, fl: -10, lean: 12, hip: 0.1, drop: 0.08, reach: 1, hand: 1.1 },
  },
  "twist-l": {
    id: "twist-l", name: "Hip Twist", cue: "twist your wrist left", emoji: "🌀", color: "#ff9f1c", gesture: "twist-left", mirror: "twist-right", swipe: "swipe-left",
    pose: { pa: 50, pf: 130, fa: -50, ff: -130, pl: 22, fl: 2, lean: -10, hip: 0.14, drop: 0.12, reach: 1, hand: 1 },
  },
  "twist-r": {
    id: "twist-r", name: "Hip Twist", cue: "twist your wrist right", emoji: "🌀", color: "#ff9f1c", gesture: "twist-right", mirror: "twist-left", swipe: "swipe-right",
    pose: { pa: 50, pf: 130, fa: -50, ff: -130, pl: -2, fl: -22, lean: 10, hip: -0.14, drop: 0.12, reach: 1, hand: 1 },
  },
  shimmy: {
    id: "shimmy", name: "Shimmy", cue: "shake it!", emoji: "✨", color: "#f15bb5", gesture: "shake", swipe: "tap",
    pose: { pa: 100, pf: 70, fa: -100, ff: -70, pl: 14, fl: -14, lean: 0, hip: 0, drop: 0.16, reach: 1, hand: 1 },
  },
};

export const MOVE_IDS = Object.keys(MOVES) as MoveId[];

/** Blend two poses (t: 0 → a, 1 → b). */
export function blend(a: Pose, b: Pose, t: number): Pose {
  const k = Math.max(0, Math.min(1, t));
  const out = {} as Pose;
  for (const key of Object.keys(a) as Array<keyof Pose>) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

/** The judgement a gesture earns for a move: "match", "mirror" (did it the other way round), or "other". */
export function matchOf(move: Move, gesture: string): "match" | "mirror" | "other" {
  if (gesture === move.gesture) return "match";
  if (move.mirror && gesture === move.mirror) return "mirror";
  return "other";
}

/** The phone actions: one per gesture, so every move the phone feels reaches the TV, judged there. */
export const GESTURE_ACTIONS: Array<{ id: string; gesture: GestureName }> = [
  { id: "up", gesture: "flick-up" }, { id: "down", gesture: "flick-down" }, { id: "left", gesture: "flick-left" },
  { id: "right", gesture: "flick-right" }, { id: "punch", gesture: "push" }, { id: "pull", gesture: "pull" },
  { id: "twl", gesture: "twist-left" }, { id: "twr", gesture: "twist-right" }, { id: "shake", gesture: "shake" },
];
export const GESTURE_OF_ACTION: Record<string, GestureName> = Object.fromEntries(GESTURE_ACTIONS.map((a) => [a.id, a.gesture]));
