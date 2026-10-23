import { GESTURES, type Gesture, type GestureKind, type MotionFrame } from "./engine.js";

/**
 * How motion travels inside the protocol's generic controller state (axes in [-1, 1], tap counters):
 *   axes.roll, axes.pitch, axes.yaw   normalised tilt / turn rate
 *   axes.ok                           1 while sensors are live and calibrated, 0 otherwise
 *   taps["push"] …                    one counter per gesture kind; taps["push!"] etc. count strong ones
 *   taps["calibrated"]                increments each time the player finishes calibrating
 * Counters (not events) survive a lost packet: the TV diffs them against the last state it saw.
 */
export const STRONG = 2;
export const strongKey = (k: GestureKind) => `${k}!`;

export function frameAxes(f: MotionFrame): Record<string, number> {
  const ok = f.calibrated && !f.health.stale ? 1 : 0;
  return { roll: f.roll, pitch: f.pitch, yaw: f.yaw, ok };
}

export interface WireState {
  axes?: Record<string, number>;
  taps?: Record<string, number>;
}

/** TV side: one per player. Turns successive controller states into tilt plus new gestures. */
export class MotionReader {
  private taps: Record<string, number> | null = null;
  roll = 0;
  pitch = 0;
  yaw = 0;
  ok = false;
  calibrations = 0;
  lastUpdate = 0;

  /** Returns the gestures performed since the previous state (strong ones have strength >= STRONG). */
  update(s: WireState, now = Date.now()): Gesture[] {
    this.lastUpdate = now;
    this.roll = s.axes?.roll ?? 0;
    this.pitch = s.axes?.pitch ?? 0;
    this.yaw = s.axes?.yaw ?? 0;
    this.ok = (s.axes?.ok ?? 0) > 0.5;
    const taps = s.taps ?? {};
    const out: Gesture[] = [];
    // A reloaded phone counts from zero again: any counter going backwards means a new controller session.
    if (this.taps && Object.keys(this.taps).some((k) => (taps[k] ?? 0) < (this.taps![k] ?? 0))) this.taps = null;
    // first state after (re)connecting: adopt the counters without replaying old gestures
    if (this.taps) {
      for (const k of GESTURES) {
        const n = Math.min(3, (taps[k] ?? 0) - (this.taps[k] ?? 0));
        const strong = Math.min(n, (taps[strongKey(k)] ?? 0) - (this.taps[strongKey(k)] ?? 0));
        for (let i = 0; i < n; i++) out.push({ kind: k, strength: i < strong ? STRONG : 1, t: now });
      }
      if ((taps.calibrated ?? 0) > (this.taps.calibrated ?? 0)) this.calibrations++;
    } else if ((taps.calibrated ?? 0) > 0) this.calibrations = 1;
    this.taps = { ...taps };
    return out;
  }

  /** Player disconnected: drop held tilt, and adopt the next counters as a fresh baseline. */
  clear() {
    this.roll = this.pitch = this.yaw = 0;
    this.ok = false;
    this.taps = null;
  }
}
