/**
 * Phone vibration. Players watch the TV, so a buzz is how the phone says "that registered" or "you got hit".
 * Players can turn it off (lobby), and in motion mode a game's buzz is kept short: a long one shakes the phone while
 * its sensors are reading the player's moves. iPhone Safari has no vibration; every call is a safe no-op there.
 */
const KEY = "pwtv.haptics";
/** Longest game-sent buzz while motion controls are reading the phone. */
export const MOTION_MAX_MS = 80;

export function hapticsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHaptics(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: this visit only */
  }
  if (!on) vibrate(0);
}

/** Pattern after the motion cap: every on-segment at most MOTION_MAX_MS. */
export function capped(ms: number | number[], motion: boolean): number | number[] {
  if (!motion) return ms;
  return Array.isArray(ms) ? ms.map((v, i) => (i % 2 === 0 ? Math.min(v, MOTION_MAX_MS) : v)) : Math.min(ms, MOTION_MAX_MS);
}

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

/** Buzz unless the player turned vibration off. `motion`: cap it (sensors are reading the player's moves). */
export function buzz(ms: number | number[], motion = false) {
  if (!hapticsOn()) return;
  const v = capped(ms, motion);
  if (Array.isArray(v) ? v.length : v > 0) vibrate(v);
}
