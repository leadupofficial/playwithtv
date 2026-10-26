import { type Vec3, clamp, cross, deg, dot, len, lerp, norm, scale, sub, v } from "./vec.js";
import { SABER_DEFAULTS, SaberDetector } from "./saber.js";
import { SWING_DEFAULTS, SwingDetector } from "./swing.js";

/**
 * One sensor reading, already in screen axes (see toScreen).
 *   gravity   accelerationIncludingGravity: the "up" reaction vector plus any movement, m/s²
 *   linear    acceleration without gravity, m/s² (null when the browser does not provide it)
 *   rotation  rotation rate around the screen x, y, z axes, deg/s (null without a gyroscope)
 */
export interface RawSample { t: number; gravity: Vec3; linear?: Vec3 | null; rotation?: Vec3 | null }

export interface MotionSettings {
  /** 0.5 (gentle) … 2 (twitchy); scales tilt output and divides every gesture threshold. */
  sensitivity: number;
  /** Tilt (degrees) ignored around neutral so a resting hand does not drift. */
  deadZoneDeg: number;
  /** Tilt (degrees, after the dead zone) that reads as full deflection ±1. */
  fullTiltDeg: number;
  /** Linear acceleration (m/s²) a deliberate flick/push must reach. */
  gestureThreshold: number;
  /** Rotation rate (deg/s) a deliberate twist must reach. */
  twistThreshold: number;
  /** After a gesture, nothing new for this long; the phone must also settle before the next one. */
  cooldownMs: number;
  /** Also detect "swing" (a bat swing in any direction, see swing.ts). Off unless a game maps it. */
  swing?: boolean;
  /** Saber cuts (rhythm games, see saber.ts): flicks come from the gyroscope and are reported at their peak. */
  saber?: boolean;
}

export const DEFAULT_SETTINGS: MotionSettings = {
  sensitivity: 1, deadZoneDeg: 3, fullTiltDeg: 28, gestureThreshold: 11, twistThreshold: 240, cooldownMs: 280,
};

/** The shared gesture vocabulary, relative to how the player held the phone at calibration. */
export type GestureKind =
  | "push" | "pull" | "flick-up" | "flick-down" | "flick-left" | "flick-right" | "twist-left" | "twist-right" | "shake"
  | "swing";
export const GESTURES: GestureKind[] = ["push", "pull", "flick-up", "flick-down", "flick-left", "flick-right", "twist-left", "twist-right", "shake", "swing"];

/** strength = peak / threshold: 1 is a minimal deliberate gesture, 2+ is a strong one. */
export interface Gesture { kind: GestureKind; strength: number; t: number }

export interface SensorHealth { rateHz: number; hasLinear: boolean; hasRotation: boolean; stale: boolean }

export interface MotionFrame {
  /** Steering-wheel turn / sideways lean, -1 (left) … 1 (right). */
  roll: number;
  /** Tip the top edge away (+1) or towards you (-1). */
  pitch: number;
  /** Turning rate around the vertical axis, -1 (left) … 1 (right). */
  yaw: number;
  rollDeg: number;
  pitchDeg: number;
  calibrated: boolean;
  still: boolean;
  health: SensorHealth;
}

const TAU_MS = 80;          // gravity low-pass time constant: separates tilt from quick movement
const QUIET = 0.35;         // fraction of the threshold the phone must settle under to re-arm
const WINDOW_MS = 100;      // a gesture's direction and peak are taken over this window
const STILL_MS = 600;
const STALE_MS = 500;

interface Pending { kind: GestureKind; start: number; peak: number; hits: number }

/**
 * Turns raw sensor samples into normalised tilt and discrete gestures.
 * Pure: no DOM, no timers; the caller feeds samples (live or from a recorded trace) and reads frames.
 */
export class MotionEngine {
  settings: MotionSettings;
  private gravity: Vec3 | null = null;
  private lastT = 0;
  private rate = 0;
  private hasLinear = false;
  private hasRotation = false;
  // calibrated frame: n = neutral up, r = neutral right, f = "top edge away" direction
  private n: Vec3 = v(0, 1, 0);
  private r: Vec3 = v(1, 0, 0);
  private f: Vec3 = v(0, 0, 1);
  private calibrated = false;
  private wantCalibration = true;
  private stillSince = 0;
  private rotZ = 0;
  // gesture state: separate arms for linear gestures and twists
  private lin = { armed: true, quietSince: 0, cooldown: 0, pending: null as Pending | null };
  private tw = { armed: true, quietSince: 0, cooldown: 0, pending: null as Pending | null };
  private shake = { lastSign: 0, flips: [] as number[], cooldown: 0, axis: "" };
  private swingDetector = new SwingDetector();
  private saberDetector = new SaberDetector();

  constructor(settings: Partial<MotionSettings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
  }

  /** The next sample defines "neutral" (call while the player holds the phone the way they will play). */
  /** Sensitivity as it applies to gestures: higher means a gentler move counts. */
  private get gain() {
    return clamp(this.settings.sensitivity, 0.5, 2) || 1;
  }

  calibrate() {
    this.wantCalibration = true;
  }

  get isCalibrated() {
    return this.calibrated;
  }

  /** Feeds one sample; returns the gestures it completed (usually none). */
  push(s: RawSample): Gesture[] {
    const dt = this.lastT ? Math.max(1, s.t - this.lastT) : 16;
    this.rate = this.rate ? this.rate * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    this.lastT = s.t;
    const k = 1 - Math.exp(-dt / TAU_MS);
    const prev = this.gravity;
    this.gravity = prev ? lerp(prev, s.gravity, k) : s.gravity;
    const jolt = len(sub(s.gravity, this.gravity));
    if (jolt > 0.6) this.stillSince = s.t;
    else if (!this.stillSince) this.stillSince = s.t;

    if (this.wantCalibration && len(this.gravity) > 3) this.setNeutral(this.gravity);

    if (s.linear) this.hasLinear = true;
    if (s.rotation) this.hasRotation = true;
    const lin = s.linear ?? sub(s.gravity, this.gravity);
    this.rotZ = s.rotation?.z ?? 0;

    const out: Gesture[] = [];
    // project onto the calibrated frame: right, up, towards the TV
    const a = v(dot(lin, this.r), dot(lin, this.n), -dot(lin, this.f));
    // the player's sensitivity also sets how hard a move must be: arms and phones differ a lot (on a real phone a
    // player's pushes peaked at 5-11 m/s² and swings at 6-8, against the 11 and 12 the defaults ask for)
    this.swingDetector.settings.threshold = SWING_DEFAULTS.threshold / this.gain;
    this.saberDetector.settings.rotThreshold = SABER_DEFAULTS.rotThreshold / this.gain;
    this.saberDetector.settings.accThreshold = SABER_DEFAULTS.accThreshold / this.gain;
    if (this.settings.saber) {
      // the blade's turn in the calibrated frame: around right, up, towards the player
      const rot = s.rotation ? v(dot(s.rotation, this.r), dot(s.rotation, this.n), dot(s.rotation, this.f)) : null;
      const c = this.saberDetector.push(rot, a, s.t);
      if (c) out.push({ kind: `flick-${c.dir}`, strength: c.strength, t: c.t });
      return out; // a cut is not also a push, a twist or a shake
    }
    const g1 = this.linear(a, s.t);
    if (g1) out.push(g1);
    const g2 = this.twist(s.rotation ?? null, s.t);
    if (g2) out.push(g2);
    const g3 = this.shaking(a, s.t);
    if (g3) out.push(g3);
    if (this.settings.swing) {
      // reported at the peak's time (when the bat would meet the ball), with a continuous strength
      const sw = this.swingDetector.push(lin, s.rotation ?? null, s.t);
      if (sw) out.push({ kind: "swing", strength: sw.strength, t: sw.t });
    }
    return out;
  }

  frame(now = this.lastT): MotionFrame {
    const st = this.settings;
    const g = norm(this.gravity ?? this.n);
    const rollDeg = deg(Math.asin(clamp(-dot(g, this.r), -1, 1)));
    const pitchDeg = deg(Math.asin(clamp(dot(g, this.f), -1, 1)));
    const shape = (d: number) => {
      const m = Math.max(0, Math.abs(d) - st.deadZoneDeg) / Math.max(1, st.fullTiltDeg);
      return clamp(Math.sign(d) * m * st.sensitivity, -1, 1) || 0; // never -0
    };
    return {
      roll: shape(rollDeg),
      pitch: shape(pitchDeg),
      yaw: this.hasRotation ? clamp(-this.rotZ / 180, -1, 1) : 0,
      rollDeg,
      pitchDeg,
      calibrated: this.calibrated,
      still: !!this.stillSince && now - this.stillSince >= STILL_MS,
      health: { rateHz: Math.round(this.rate), hasLinear: this.hasLinear, hasRotation: this.hasRotation, stale: !this.lastT || now - this.lastT > STALE_MS },
    };
  }

  private setNeutral(gravity: Vec3) {
    const n = norm(gravity);
    // right = screen x with the up component removed; if x itself points up (phone on its side), use screen y
    let r = sub(v(1, 0, 0), scale(n, n.x));
    if (len(r) < 0.3) r = sub(v(0, -1, 0), scale(n, -n.y));
    r = norm(r);
    this.n = n;
    this.r = r;
    this.f = norm(cross(r, n));
    this.calibrated = true;
    this.wantCalibration = false;
  }

  /** Push / pull / flicks: arm when quiet, take the first strong direction, require a sustained peak. */
  private linear(a: Vec3, t: number): Gesture | null {
    const th = this.settings.gestureThreshold / this.gain;
    const st = this.lin;
    const mag = len(a);
    if (!st.armed) {
      if (mag < th * QUIET) {
        st.quietSince ||= t;
        if (t - st.quietSince >= 60) st.armed = true;
      } else st.quietSince = 0;
      return null;
    }
    if (st.pending) {
      st.pending.peak = Math.max(st.pending.peak, mag);
      if (mag > th * 0.6) st.pending.hits++;
      if (t - st.pending.start < WINDOW_MS) return null;
      const p = st.pending;
      st.pending = null;
      // a lone spike (a knock on the table, a dropped sample) is not a gesture; slow sensors get one sample
      const needed = this.rate && this.rate < 30 ? 1 : 2;
      if (p.hits < needed) return null;
      st.armed = false;
      st.quietSince = 0;
      st.cooldown = t + this.settings.cooldownMs;
      return { kind: p.kind, strength: Math.round((p.peak / th) * 100) / 100, t };
    }
    if (t < st.cooldown || mag <= th) return null;
    const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
    const kind: GestureKind = az >= ax && az >= ay ? (a.z > 0 ? "push" : "pull")
      : ax >= ay ? (a.x > 0 ? "flick-right" : "flick-left")
      : a.y > 0 ? "flick-up" : "flick-down";
    st.pending = { kind, start: t, peak: mag, hits: 1 };
    return null;
  }

  /** Twists: a quick rotation around the axis through the screen, needs a gyroscope. */
  private twist(rot: Vec3 | null, t: number): Gesture | null {
    if (!rot) return null;
    const th = this.settings.twistThreshold / this.gain;
    const st = this.tw;
    const mag = Math.abs(rot.z);
    if (!st.armed) {
      if (mag < th * QUIET) {
        st.quietSince ||= t;
        if (t - st.quietSince >= 60) st.armed = true;
      } else st.quietSince = 0;
      return null;
    }
    if (st.pending) {
      st.pending.peak = Math.max(st.pending.peak, mag);
      if (mag > th * 0.6) st.pending.hits++;
      if (t - st.pending.start < WINDOW_MS) return null;
      const p = st.pending;
      st.pending = null;
      if (p.hits < 2) return null;
      st.armed = false;
      st.quietSince = 0;
      st.cooldown = t + this.settings.cooldownMs;
      return { kind: p.kind, strength: Math.round((p.peak / th) * 100) / 100, t };
    }
    if (t < st.cooldown || mag <= th) return null;
    st.pending = { kind: rot.z > 0 ? "twist-left" : "twist-right", start: t, peak: mag, hits: 1 };
    return null;
  }

  /** Shake: five quick back-and-forth reversals within 0.7 s (used for "mash" style actions). */
  private shaking(a: Vec3, t: number): Gesture | null {
    const th = (this.settings.gestureThreshold * 0.65) / this.gain;
    const sh = this.shake;
    const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z);
    const axis = az >= ax && az >= ay ? "z" : ax >= ay ? "x" : "y";
    const val = axis === "x" ? a.x : axis === "y" ? a.y : a.z;
    if (Math.abs(val) < th) return null;
    const sign = Math.sign(val);
    if (sign !== sh.lastSign) {
      sh.lastSign = sign;
      // a shake is continuous back-and-forth: a pause between reversals starts over (two pushes are not a shake)
      const prev = sh.flips[sh.flips.length - 1];
      if (prev !== undefined && t - prev > 250) sh.flips = [];
      sh.flips = sh.flips.filter((f) => t - f < 700);
      sh.flips.push(t);
    }
    if (sh.flips.length >= 5 && t >= sh.cooldown) {
      sh.flips = [];
      sh.cooldown = t + 400;
      return { kind: "shake", strength: 1, t };
    }
    return null;
  }
}
