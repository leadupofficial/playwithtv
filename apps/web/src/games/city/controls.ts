/**
 * CITY RIVALS on the phones. Same feel as GHAT RUSH (gas is automatic, one big DRIFT, a BOOST tap), so the input
 * reader is GHAT RUSH's; this game adds the garage: steer left / right to change vehicle, BOOST to lock it in.
 *   hybrid   turn the phone like a wheel · HOLD DRIFT · tap BOOST
 *   buttons  ◀ ▶ to steer · HOLD DRIFT · tap BOOST
 *   motion   turn to steer · flick sideways to drift (straighten to fire the turbo) · push = BOOST
 */
import type { ControlSpec } from "@playwithtv/protocol";

export const CONTROLS: ControlSpec = {
  title: "CITY RIVALS",
  modes: ["hybrid", "buttons", "motion"],
  stick: "arrows-h",
  tilt: "steer",
  actions: [
    { id: "drift", label: "🌀 HOLD DRIFT", color: "#7c3aed", hold: true, gestures: ["flick-left", "flick-right"] },
    { id: "boost", label: "🔥 BOOST", color: "#ff6a00", gestures: ["push"] },
  ],
  hints: {
    hybrid: "Turn the phone like a wheel · HOLD DRIFT round corners, let go for a turbo · tap BOOST",
    buttons: "◀ ▶ to steer · HOLD DRIFT round corners, let go for a turbo · tap BOOST",
    motion: "Turn to steer (gas is automatic) · flick sideways to drift, straighten to fire · push = boost",
  },
};

/** Garage: turning the wheel (or ◀ ▶) past this moves the highlight once; back under RELEASE re-arms it. */
export const PICK_AT = 0.55;
export const RELEASE = 0.25;

export interface PickEdge { armed: boolean }

/** One garage reading: −1 / +1 when the steer just crossed PICK_AT, else 0. Pure. */
export function pickEdge(e: PickEdge, steer: number): -1 | 0 | 1 {
  if (Math.abs(steer) < RELEASE) e.armed = true;
  if (e.armed && Math.abs(steer) >= PICK_AT) {
    e.armed = false;
    return steer > 0 ? 1 : -1;
  }
  return 0;
}
