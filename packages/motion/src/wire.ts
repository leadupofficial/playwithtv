import type { MotionFrame } from "./engine.js";

/**
 * How a controller's state travels inside the protocol (axes in [-1, 1], tap counters, held buttons):
 *   axes.x, axes.y                    movement from any mode: stick, tilt or touchpad (x right, y up/forward)
 *   axes.roll, axes.pitch, axes.yaw   raw tilt (motion and hybrid modes)
 *   axes.ok                           1 while the controller is ready (sensors live and calibrated, or buttons)
 *   axes.m                            the mode code / 3 (0 buttons, 1/3 motion, 2/3 hybrid, 1 touchpad)
 *   taps[action]                      a counter per game action (the phone maps gestures/swipes to actions)
 *   buttons[action]                   held actions
 *   taps["calibrated"]                increments each time the player finishes calibrating
 * Counters (not events) survive a lost packet: the TV diffs them against the last state it saw.
 */
export const STRONG = 2;

export function frameAxes(f: MotionFrame): Record<string, number> {
  const ok = f.calibrated && !f.health.stale ? 1 : 0;
  return { x: f.roll, y: f.pitch, roll: f.roll, pitch: f.pitch, yaw: f.yaw, ok };
}

export interface WireState {
  axes?: Record<string, number>;
  taps?: Record<string, number>;
  buttons?: Record<string, boolean>;
}

/** TV side: one per player. Turns successive controller states into movement, held actions and new taps. */
export class ControlReader {
  private taps: Record<string, number> | null = null;
  private heldNow: Record<string, boolean> = {};
  x = 0;
  y = 0;
  roll = 0;
  pitch = 0;
  yaw = 0;
  ok = false;
  /** 0 buttons, 1 motion, 2 hybrid, 3 touchpad */
  mode = 0;
  calibrations = 0;
  lastUpdate = 0;

  /** Returns the actions tapped since the previous state (an action tapped twice appears twice, at most 3). */
  update(s: WireState, now = Date.now()): string[] {
    this.lastUpdate = now;
    const a = s.axes ?? {};
    this.roll = a.roll ?? 0;
    this.pitch = a.pitch ?? 0;
    this.yaw = a.yaw ?? 0;
    this.x = a.x ?? this.roll;
    this.y = a.y ?? this.pitch;
    this.ok = (a.ok ?? 0) > 0.5;
    this.mode = Math.round((a.m ?? 0) * 3); // sent as code / 3 (axes are clamped to [-1, 1])
    this.heldNow = { ...s.buttons };
    const taps = s.taps ?? {};
    const out: string[] = [];
    // A reloaded phone counts from zero again: any counter going backwards means a new controller session.
    if (this.taps && Object.keys(this.taps).some((k) => (taps[k] ?? 0) < (this.taps![k] ?? 0))) this.taps = null;
    // first state after (re)connecting: adopt the counters without replaying old taps
    if (this.taps) {
      for (const k of Object.keys(taps)) {
        if (k === "calibrated") continue;
        const n = Math.min(3, (taps[k] ?? 0) - (this.taps[k] ?? 0));
        for (let i = 0; i < n; i++) out.push(k);
      }
      if ((taps.calibrated ?? 0) > (this.taps.calibrated ?? 0)) this.calibrations++;
    } else if ((taps.calibrated ?? 0) > 0) this.calibrations = 1;
    this.taps = { ...taps };
    return out;
  }

  held(action: string): boolean {
    return !!this.heldNow[action];
  }

  /** Player disconnected: drop movement and held actions, adopt the next counters as a fresh baseline. */
  clear() {
    this.x = this.y = this.roll = this.pitch = this.yaw = 0;
    this.ok = false;
    this.heldNow = {};
    this.taps = null;
  }
}
