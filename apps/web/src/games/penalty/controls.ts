import type { ControlAction, ControlSpec } from "@playwithtv/protocol";
import { clamp, type Dive, type Vec } from "./geometry";

/**
 * Controls for both roles. Every phone gets the spec for its role before each kick (same title, so the
 * player's chosen mode stays), so it only ever shows the buttons that matter right now:
 *
 *   buttons (default)  KICKER: joystick moves the crosshair; hold KICK to charge, release to shoot; the
 *                      joystick's ◀ ▶ while charging curls the ball.  KEEPER: ◀ DIVE / JUMP / DIVE ▶,
 *                      or point the joystick and tap DIVE (up/down on the stick dives high/low).
 *   motion             KICKER: tilt to aim, push towards the TV to shoot (a strong push = power shot;
 *                      still sweeping the aim as you push curls it).  KEEPER: flick left/right to dive, up to jump.
 *   touchpad           KICKER: swipe up the pad like kicking the ball: the swipe's angle aims left/right,
 *                      where you let go sets the height, its length the power, an arc curls it.
 *                      KEEPER: swipe left/right to dive (higher on the pad = higher dive), up to jump.
 *
 * Buttons are the default: no calibration, exact aim and power, and both roles work the same on every phone.
 */
const TITLE = "Global Penalty Cup";
const MODES: ControlSpec["modes"] = ["buttons", "motion", "touchpad"];

const DIVE_ACTIONS: ControlAction[] = [
  { id: "diveL", label: "◀ DIVE", color: "#1f7ae0", gestures: ["flick-left"], swipes: ["swipe-left"] },
  { id: "jump", label: "▲ JUMP", color: "#7c3aed", gestures: ["flick-up"], swipes: ["swipe-up"] },
  { id: "diveR", label: "DIVE ▶", color: "#1f7ae0", gestures: ["flick-right"], swipes: ["swipe-right"] },
  { id: "dive", label: "🧤 DIVE (stick)", color: "#0e9f6e", buttonIn: ["buttons"] },
];

/** The get-ready screen: practise a kick (KICK taps here, a push, or a swipe up). */
export const TUTORIAL_SPEC: ControlSpec = {
  title: TITLE,
  modes: MODES,
  stick: "joystick",
  tilt: "aim",
  actions: [
    { id: "shoot", label: "⚽ KICK", color: "#e2384d", gestures: ["push"], swipes: ["swipe-up"] },
    ...DIVE_ACTIONS.slice(0, 3), // swipe-up is the kick here (the first action that lists it wins)
  ],
  hints: {
    buttons: "Kicker: joystick aims, hold KICK to power up, let go to shoot · Keeper: tap a DIVE button",
    motion: "Kicker: tilt to aim, push towards the TV to shoot · Keeper: flick left / right / up to dive",
    touchpad: "Kicker: swipe up to shoot (angle = aim, length = power) · Keeper: swipe to dive",
  },
};

export const KICKER_SPEC: ControlSpec = {
  title: TITLE,
  modes: MODES,
  stick: "joystick",
  tilt: "aim",
  calibrate: false,
  actions: [
    { id: "kick", label: "⚽ HOLD TO KICK", color: "#e2384d", hold: true, buttonIn: ["buttons"] },
    { id: "shoot", label: "SHOOT", gestures: ["push"], swipes: ["swipe-up", "swipe-left", "swipe-right"], buttonIn: [] },
    { id: "blast", label: "POWER SHOT", strongOf: "shoot", buttonIn: [] },
  ],
  hints: {
    buttons: "Aim with the joystick · hold KICK to power up, let go to shoot · ◀ ▶ while holding = curl",
    motion: "Tilt to aim · push towards the TV to shoot (harder = power shot)",
    touchpad: "Swipe up to shoot: angle = aim, let go high = high shot, longer = harder",
  },
};

export const KEEPER_SPEC: ControlSpec = {
  title: TITLE,
  modes: MODES,
  stick: "joystick",
  tilt: "aim",
  calibrate: false,
  actions: DIVE_ACTIONS,
  hints: {
    buttons: "Dive early to guess, or react to the shot · stick ▲▼ = high / low dive",
    motion: "Flick left or right to dive, flick up to jump",
    touchpad: "Swipe left / right to dive (higher on the pad = higher), swipe up to jump",
  },
};

export const WATCH_SPEC: ControlSpec = {
  title: TITLE,
  modes: MODES,
  stick: "none",
  tilt: "none",
  calibrate: false,
  actions: [{ id: "cheer", label: "📣 CHEER", color: "#ff7a59", gestures: ["shake", "push"], swipes: ["tap", "swipe-up"], buttonIn: ["buttons", "touchpad"] }],
  hints: { buttons: "Watch the kick · tap CHEER", motion: "Watch the kick · shake to cheer", touchpad: "Watch the kick · tap to cheer" },
};

/** A keeper action as a dive; `dy` comes from the stick / pad height (null = no dive). */
export function diveFor(action: string, stick: Vec, padY = 0): Dive | null {
  const high = clamp(stick.y + padY, -1, 1);
  if (action === "diveL") return { dx: -1, dy: high };
  if (action === "diveR") return { dx: 1, dy: high };
  if (action === "jump") return { dx: 0, dy: 1 };
  if (action === "dive") {
    if (Math.hypot(stick.x, stick.y) < 0.3) return null; // stick centred: stand big
    return Math.abs(stick.x) < 0.3 ? { dx: 0, dy: stick.y > 0 ? 1 : -1 } : { dx: Math.sign(stick.x), dy: clamp(stick.y, -1, 1) };
  }
  return null;
}

/** A touchpad sample: finger position on the pad (x right, y up, -1…1) and when (ms). */
export interface PadSample { x: number; y: number; t: number }

/**
 * Turns the last touchpad drag into a shot. The swipe's angle from straight up aims left/right (45° reaches
 * a post), where the finger left the pad sets the height, its length sets the power, and how far the middle
 * of the drag bowed away from a straight line curls the ball.
 */
export function swipeShot(samples: PadSample[]): { aim: Vec; power: number; curve: number } {
  const last = samples[samples.length - 1];
  if (!last) return { aim: { x: 0, y: 0.4 }, power: 0.75, curve: 0 };
  const first = samples[0]!;
  const dx = last.x - first.x, dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  const angle = len > 0.05 ? Math.atan2(dx, Math.max(0.05, dy)) : Math.atan2(last.x, 1);
  const aim = { x: clamp(angle / (Math.PI / 4), -1.1, 1.1) * 0.92, y: clamp((last.y + 0.6) / 1.5, 0, 1.1) };
  let curve = 0;
  if (samples.length >= 3 && len > 0.1) {
    const mid = samples[Math.floor(samples.length / 2)]!;
    // signed distance of the middle point from the chord: bowed left first = the ball bends back to the right
    const cross = (dx * (mid.y - first.y) - dy * (mid.x - first.x)) / len;
    curve = clamp(cross * 2.5, -1, 1);
  }
  return { aim, power: clamp(0.55 + len * 0.25, 0.55, 1.1), curve };
}

/** Keeps the recent touchpad drag (positions while a finger is down). A lift resets it after a gap. */
export class PadTrail {
  samples: PadSample[] = [];
  private lastDown = -1e9;
  add(x: number, y: number, t: number) {
    const down = x !== 0 || y !== 0;
    if (!down) return;
    if (t - this.lastDown > 160) this.samples = [];
    this.lastDown = t;
    const prev = this.samples[this.samples.length - 1];
    if (prev && prev.x === x && prev.y === y) return;
    this.samples.push({ x, y, t });
    if (this.samples.length > 24) this.samples.shift();
  }
  /** The drag that just ended (empty if the finger lifted more than `maxAgeMs` ago). */
  take(now: number, maxAgeMs = 500): PadSample[] {
    const s = now - this.lastDown <= maxAgeMs ? this.samples : [];
    this.samples = [];
    return s;
  }
  lastY(now: number): number {
    return now - this.lastDown <= 500 ? this.samples[this.samples.length - 1]?.y ?? 0 : 0;
  }
}
