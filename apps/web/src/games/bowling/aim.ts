import type { Shot } from "./physics";

/**
 * Turns one player's controller into a shot, pure (no DOM). Every mode can set the same three things (where
 * to stand, which way to aim, how much hook) plus the speed, each in the way that suits it:
 *
 *   motion    turn the phone like a wheel to swing the aim arrow; flick sideways to step left/right; twist to
 *             add hook; push towards the TV to roll (a strong push rolls faster)
 *   buttons   ◀ ▶ walk; hold ROLL: the power meter swings and ◀ ▶ now steer the arrow; let go to roll;
 *             SPIN cycles straight / hook left / hook right
 *   touchpad  drag sideways to walk; swipe up to roll (slant the swipe to aim, a longer swipe is faster);
 *             swipe left/right to add hook
 */

export const POS_MAX = 0.4;          // standing range across the lane (m)
export const ANGLE_MAX = 0.03;       // ≈1.7°: enough to cross the lane from either edge
export const STEP = 0.07;            // one flick
export const METER_PERIOD = 1.8;     // the power meter's swing (s)
export const SPEED_MIN = 5.8, SPEED_MAX = 9;
const HISTORY = 32;

export type AimMode = "buttons" | "motion" | "hybrid" | "touchpad";

export interface AimInput {
  mode: AimMode;
  ok: boolean;
  x: number;
  y: number;
  /** Buttons mode: the ROLL button is held. */
  rollHeld: boolean;
}

interface Stroke { startPos: number; x0: number; y0: number; x1: number; y1: number; endedAt: number }

export interface Aim {
  pos: number;
  angle: number;
  spin: number;
  /** Buttons: charging the roll (ROLL held). */
  charging: boolean;
  chargeT: number;
  /** 0…1 power shown on the TV while charging. */
  meter: number;
  /** Seconds since aiming started (for the shot clock). */
  t: number;
  walkT: number;
  hist: Float32Array;
  histI: number;
  stroke: Stroke | null;
  touching: boolean;
  wasHeld: boolean;
}

export function newAim(pos = 0, spin = 0): Aim {
  return { pos, angle: 0, spin, charging: false, chargeT: 0, meter: 0, t: 0, walkT: 0, hist: new Float32Array(HISTORY), histI: 0, stroke: null, touching: false, wasHeld: false };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The swinging power meter: 0 → 1 → 0 over METER_PERIOD. */
export function meterAt(t: number) {
  const p = (t % METER_PERIOD) / METER_PERIOD;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

export const speedFor = (power: number) => SPEED_MIN + (SPEED_MAX - SPEED_MIN) * clamp(power, 0, 1);

/** Per fixed step. Returns a shot when the player let go of ROLL (buttons mode), else null. */
export function updateAim(a: Aim, inp: AimInput, dt: number): Shot | null {
  a.t += dt;
  let shot: Shot | null = null;
  if (inp.mode === "buttons") {
    const held = inp.ok && inp.rollHeld;
    if (held && !a.wasHeld) { a.charging = true; a.chargeT = 0; }
    if (a.charging) {
      a.chargeT += dt;
      a.meter = meterAt(a.chargeT);
      a.angle = clamp(a.angle + (inp.ok ? inp.x : 0) * 0.025 * dt, -ANGLE_MAX, ANGLE_MAX);
      if (!held) {
        a.charging = false;
        shot = { x: a.pos, angle: a.angle, speed: speedFor(a.meter), spin: a.spin };
      }
    } else if (inp.ok && Math.abs(inp.x) > 0.3) {
      a.walkT += dt;
      const v = 0.12 + Math.min(0.28, a.walkT * 0.35);        // taps nudge, holding walks faster
      a.pos = clamp(a.pos + Math.sign(inp.x) * v * dt, -POS_MAX, POS_MAX);
    } else a.walkT = 0;
    a.wasHeld = held;
  } else if (inp.mode === "touchpad") {
    const touching = inp.ok && !(inp.x === 0 && inp.y === 0); // the pad reports exactly 0,0 when the finger lifts
    if (touching && !a.touching) a.stroke = { startPos: a.pos, x0: inp.x, y0: inp.y, x1: inp.x, y1: inp.y, endedAt: -1 };
    if (touching && a.stroke) {
      a.stroke.x1 = inp.x;
      a.stroke.y1 = inp.y;
      a.pos = clamp(a.stroke.startPos + (inp.x - a.stroke.x0) * POS_MAX, -POS_MAX, POS_MAX);
    }
    if (!touching && a.touching && a.stroke) a.stroke.endedAt = a.t;
    a.touching = touching;
  } else {
    // motion (and hybrid): the phone's turn swings the arrow, smoothed so a shaky hand still aims
    const target = inp.ok ? clamp(inp.x * 1.25, -1, 1) * ANGLE_MAX : a.angle;
    a.angle += (target - a.angle) * Math.min(1, dt / 0.12);
  }
  a.hist[a.histI] = a.angle;
  a.histI = (a.histI + 1) % HISTORY;
  return shot;
}

/** The aim a moment ago (a push gesture jolts the phone; the shot uses the steady aim from before it). */
function steadyAngle(a: Aim, stepsBack = 18) {
  return a.hist[(a.histI - stepsBack + HISTORY * 2) % HISTORY]!;
}

/** A tap action arrived (roll / power / spin / step / hook). Returns a shot when it rolls the ball. */
export function aimAction(a: Aim, mode: AimMode, action: string): Shot | null {
  if (action === "spin") { a.spin = a.spin === 0 ? -1 : a.spin === -1 ? 1 : 0; return null; }
  if (action === "stepL" || action === "stepR") {
    a.pos = clamp(a.pos + (action === "stepL" ? -STEP : STEP), -POS_MAX, POS_MAX);
    return null;
  }
  if (action === "hookL" || action === "hookR") {
    if (mode === "touchpad") revertStroke(a);
    a.spin = clamp(a.spin + (action === "hookL" ? -1 : 1), -1, 1);
    return null;
  }
  if (action !== "roll" && action !== "power") return null;
  if (mode === "buttons") return null;                     // buttons roll on release of the held ROLL button
  if (mode === "touchpad") {
    const s = revertStroke(a);
    let angle = 0, speed = speedFor(0.55);
    if (s) {
      const dx = s.x1 - s.x0, dy = Math.max(0.2, s.y1 - s.y0);
      angle = clamp((dx / dy) / 0.4, -1, 1) * ANGLE_MAX;
      speed = speedFor(clamp((s.y1 - s.y0 - 0.3) / 1.0, 0, 1));
    }
    a.angle = angle;
    return { x: a.pos, angle, speed, spin: a.spin };
  }
  const angle = steadyAngle(a);
  return { x: a.pos, angle, speed: action === "power" ? speedFor(0.9) : speedFor(0.5), spin: a.spin };
}

/** A swipe is not a walk: put the bowler back where the stroke started. */
function revertStroke(a: Aim): Stroke | null {
  const s = a.stroke;
  if (!s || (s.endedAt >= 0 && a.t - s.endedAt > 0.6)) return null;
  a.pos = s.startPos;
  a.stroke = null;
  return s;
}

/** The shot the TV rolls for a player who ran out of time. */
export function autoShot(a: Aim): Shot {
  return { x: a.pos, angle: a.angle, speed: speedFor(0.5), spin: a.spin };
}
