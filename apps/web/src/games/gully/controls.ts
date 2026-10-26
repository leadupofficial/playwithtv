/**
 * Gully Super Over controls. Each phone gets the spec for its role before every ball (batting, bowling or
 * watching); bat and bowl have their own titles, so a player can swing in motion mode and bowl on the touchpad.
 *
 *   BAT    motion (default): swing the phone like a bat; timing = direction, swing strength = power, a gentle
 *          swing blocks.  buttons: tap SWING on time, stick ◀ ▶ = leg / off side, ▲ = go big, DEFEND blocks.
 *   BOWL   touchpad (default): drag on the pad to set line (left/right) and length (up = short, down = full),
 *          PACE / SPIN, then BOWL or flick up.  buttons: the stick aims.  motion: tilt aims, twist picks the
 *          type, push towards the TV bowls.
 */
import type { ControlSpec } from "@playwithtv/protocol";
import type { BallKind, BowlPlan } from "./sim/delivery";
import type { Swing } from "./sim/shot";
import { clamp } from "./sim/lane";

export const BAT_TITLE = "Gully Super Over · Bat";
export const BOWL_TITLE = "Gully Super Over · Bowl";

export const BAT_SPEC: ControlSpec = {
  grip: "any",
  title: BAT_TITLE,
  modes: ["motion", "buttons"],
  stick: "joystick",
  tilt: "none",
  calibrate: false,
  actions: [
    { id: "swing", label: "🏏 SWING", color: "#ff8a1f", gestures: ["swing"] },
    { id: "defend", label: "🛡 DEFEND", color: "#2f9bff", buttonIn: ["buttons"] },
  ],
  hints: {
    motion: "Hold the phone like a bat · swing as the ball reaches you (harder = bigger, gentle = block)",
    buttons: "Tap SWING as the ball arrives · stick ◀ ▶ leg / off side, ▲ go big · DEFEND to block",
  },
};

/** The get-ready screen: everyone practises a swing (with the batting controls). */
export const TUTORIAL_SPEC: ControlSpec = { ...BAT_SPEC, calibrate: true };

export const BOWL_SPEC: ControlSpec = {
  grip: "any",
  title: BOWL_TITLE,
  modes: ["touchpad", "buttons", "motion"],
  stick: "joystick",
  tilt: "aim",
  calibrate: false,
  actions: [
    { id: "bowl", label: "🎯 BOWL", color: "#e2384d", gestures: ["push"], swipes: ["swipe-up"], buttonIn: ["buttons", "touchpad"] },
    { id: "pace", label: "⚡ PACE", color: "#ff8a1f", gestures: ["twist-right"], buttonIn: ["buttons", "touchpad"] },
    { id: "spin", label: "🌀 SPIN", color: "#7c3aed", gestures: ["twist-left"], buttonIn: ["buttons", "touchpad"] },
  ],
  hints: {
    touchpad: "Drag to aim: ◀ ▶ line, ▲ short, ▼ full · PACE or SPIN · BOWL (or flick up) to let it go",
    buttons: "Stick aims: ◀ ▶ line, ▲ short, ▼ full · PACE or SPIN · BOWL",
    motion: "Tilt to aim · twist to switch pace / spin · push towards the TV to bowl",
  },
};

export const WATCH_SPEC: ControlSpec = {
  grip: "any",
  title: "Gully Super Over · Watch",
  modes: ["buttons", "touchpad", "motion"],
  stick: "none",
  tilt: "none",
  calibrate: false,
  actions: [{ id: "cheer", label: "📣 CHEER", color: "#ffb703", gestures: ["shake", "push"], swipes: ["tap", "swipe-up"], buttonIn: ["buttons", "touchpad"] }],
  hints: { buttons: "Watch the TV · tap CHEER for your team", touchpad: "Watch the TV · tap to cheer", motion: "Watch the TV · shake to cheer" },
};

/** Seconds a swing reaches the TV after the bat would have met the ball (sensing, radio, TV picture lag). */
export const SWING_LAG = { motion: 0.12, buttons: 0.07 } as const;

/**
 * A swing from the batter's controller. Motion: the gesture strength sets the power (a gentle swing blocks).
 * Buttons: SWING with the stick's aim and loft, or DEFEND.
 */
export function swingFrom(action: "swing" | "defend", mode: "motion" | "buttons", strength: number, stick: { x: number; y: number }): Swing & { lag: number } {
  if (mode === "motion") {
    const s = strength || 2; // older phones send no strength: a proper swing
    if (s < 1.25) return { dtMs: 0, power: 0.2, defend: true, lag: SWING_LAG.motion };
    return { dtMs: 0, power: clamp((s - 1.1) / 1.6, 0.25, 1), aim: 0, loft: clamp((s - 2) * 0.4, -0.3, 0.6), lag: SWING_LAG.motion };
  }
  if (action === "defend") return { dtMs: 0, power: 0.2, defend: true, lag: SWING_LAG.buttons };
  return { dtMs: 0, power: 0.55 + Math.max(0, stick.y) * 0.45, aim: clamp(stick.x, -1, 1), loft: clamp(stick.y, -1, 1), lag: SWING_LAG.buttons };
}

/** Pad / stick / tilt position → line and length (x right = off side for the TV picture: screen left). */
export function aimFrom(x: number, y: number): { line: number; length: number } {
  // from the bowler's end the off side is on screen LEFT, so pad-left aims at the off side
  return { line: clamp(-x * 1.3, -1.4, 1.4), length: clamp((y + 1) / 2, 0, 1) };
}

/**
 * The bowler's aim from touchpad drags or the stick: the last position held, which stays when the finger lifts.
 * A flick up to bowl would drag the aim with it, so BOWL uses where the aim was just before the flick.
 */
export class AimLatch {
  aim = { line: 0, length: 0.45 };
  kind: BallKind = "pace";
  private hist: Array<{ t: number; line: number; length: number }> = [];

  /** Feeds the controller position (seconds). Tilt (motion) passes `live` = true: always follows. */
  feed(x: number, y: number, t: number, live = false) {
    if (!live && Math.abs(x) < 0.02 && Math.abs(y) < 0.02) return;
    this.aim = aimFrom(x, y);
    this.hist.push({ t, ...this.aim });
    while (this.hist.length > 40 || (this.hist.length && t - this.hist[0]!.t > 2)) this.hist.shift();
  }

  /** The aim to bowl with, at time t: where it was `settle` seconds earlier (before a release flick). */
  release(t: number, settle = 0.3): BowlPlan {
    let a = this.aim;
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (this.hist[i]!.t <= t - settle) {
        a = this.hist[i]!;
        break;
      }
    }
    return { line: a.line, length: a.length, kind: this.kind };
  }

  reset() {
    this.aim = { line: 0, length: 0.45 };
    this.hist = [];
  }
}
