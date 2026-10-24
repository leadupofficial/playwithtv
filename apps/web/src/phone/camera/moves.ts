/**
 * Per-move state machines for camera mode. Each takes the body features of one frame (already smoothed,
 * normalised by the player's calibrated size) and reports a move once it is complete. Every machine uses
 * hysteresis (different thresholds in and out), a dwell time (~120 ms) so a single noisy frame can't fire it,
 * and a refractory period so one movement is one move.
 */

/** One frame of body measurements. Lengths are in units of the calibrated torso (T), shoulder width (SW) or body height (H). */
export interface Features {
  t: number;
  /** Hip drop below the standing hip height, in torsos (0 standing, ~0.5 at a parallel squat). */
  hipDrop: number;
  /** Mean hip-knee-ankle angle (degrees, 2D), NaN when the legs are not visible. */
  kneeAngle: number;
  /** Knee gap / ankle gap: below ~0.75 the knees cave in (poor squat form). */
  kneeRatio: number;
  /** Ankles and hips above their standing height, in body heights (jumps). */
  ankleRise: number;
  hipRise: number;
  /** Absolute ankle and hip heights (frame units, y down) for the rise-within-250-ms test. */
  ankleY: number;
  hipY: number;
  /** Body height in frame units (calibrated). */
  H: number;
  /** Upper-body lean from vertical, degrees: + is the player's right. */
  leanDeg: number;
  /** Each wrist's height above the nose, in torsos (+ above). */
  wristUpL: number;
  wristUpR: number;
  /** Each wrist's height below the shoulder line, in torsos (+ below). */
  wristDownL: number;
  wristDownR: number;
  /** Ankle and wrist gaps, in calibrated shoulder widths. */
  ankleSpread: number;
  wristSpread: number;
  /** Both hands resting on the head with the elbows out. */
  handsOnHead: boolean;
  /** How far each wrist is in front of its shoulder (towards the camera), in shoulder widths. */
  reachL: number;
  reachR: number;
  /** Wrist at chest height (a punch, not a raise). */
  chestL: boolean;
  chestR: boolean;
  legsVisible: boolean;
}

export const DWELL_MS = 120;

/** True once `cond` has held for `ms`. */
export class Dwell {
  private since: number | null = null;
  check(cond: boolean, t: number, ms = DWELL_MS): boolean {
    if (!cond) {
      this.since = null;
      return false;
    }
    this.since ??= t;
    return t - this.since >= ms;
  }
  reset() {
    this.since = null;
  }
}

export interface SquatRep {
  /** 0..1: depth, knees tracking over the toes, and balance. */
  quality: number;
  depth: number;
}

/** Squat: hips drop (or knees bend) then the player stands tall again. A jump's crouch is not a squat. */
export class SquatMachine {
  state: "up" | "down" = "up";
  private enter = new Dwell();
  private exit = new Dwell();
  private refractoryUntil = 0;
  private maxDrop = 0;
  private minKneeRatio = Infinity;
  private maxLean = 0;
  private airborne = false;
  lastAirAt = -Infinity;

  update(f: Features): SquatRep | null {
    if (this.state === "up") {
      const down = f.hipDrop > 0.25 || (f.kneeAngle < 110 && f.hipDrop > 0.12);
      if (f.t >= this.refractoryUntil && this.enter.check(down, f.t)) {
        this.state = "down";
        this.exit.reset();
        this.maxDrop = f.hipDrop;
        this.minKneeRatio = Number.isFinite(f.kneeRatio) ? f.kneeRatio : Infinity;
        this.maxLean = Math.abs(f.leanDeg);
        this.airborne = f.t - this.lastAirAt < 400; // the crouch before or after a jump
      }
      return null;
    }
    this.maxDrop = Math.max(this.maxDrop, f.hipDrop);
    if (Number.isFinite(f.kneeRatio) && f.hipDrop > 0.2) this.minKneeRatio = Math.min(this.minKneeRatio, f.kneeRatio);
    this.maxLean = Math.max(this.maxLean, Math.abs(f.leanDeg));
    if (f.ankleRise > 0.05) this.airborne = true;
    const up = f.hipDrop < 0.1 && !(f.kneeAngle < 150);
    if (!this.exit.check(up, f.t)) return null;
    this.state = "up";
    this.enter.reset();
    this.refractoryUntil = f.t + 350;
    if (this.airborne || f.t - this.lastAirAt < 300) return null;
    const depth = clamp01((this.maxDrop - 0.25) / 0.2);
    const knees = Number.isFinite(this.minKneeRatio) ? clamp01((this.minKneeRatio - 0.6) / 0.25) : 1;
    const balance = clamp01(1 - (this.maxLean - 8) / 12);
    return { quality: round2(0.5 * depth + 0.25 * knees + 0.25 * balance), depth: round2(this.maxDrop) };
  }

  reset() {
    this.state = "up";
    this.enter.reset();
    this.exit.reset();
  }
}

/** Jump: hips and ankles both rise by `rise` body heights within 250 ms. Fires at take-off. */
export class JumpMachine {
  private hist: Array<{ t: number; ankleY: number; hipY: number }> = [];
  private air = false;
  private landed = new Dwell();
  private airSince = 0;
  private refractoryUntil = 0;

  constructor(private rise = 0.12) {}

  update(f: Features): boolean {
    this.hist.push({ t: f.t, ankleY: f.ankleY, hipY: f.hipY });
    while (this.hist.length && f.t - this.hist[0]!.t > 250) this.hist.shift();
    if (this.air) {
      const down = f.ankleRise < 0.04;
      if (this.landed.check(down, f.t, 100) || f.t - this.airSince > 1200) {
        this.air = false;
        this.refractoryUntil = f.t + 300;
      }
      return false;
    }
    if (f.t < this.refractoryUntil) return false;
    let ankleLow = -Infinity, hipLow = -Infinity;
    for (const h of this.hist) {
      ankleLow = Math.max(ankleLow, h.ankleY);
      hipLow = Math.max(hipLow, h.hipY);
    }
    const ankleUp = (ankleLow - f.ankleY) / f.H;
    const hipUp = (hipLow - f.hipY) / f.H;
    if (ankleUp > this.rise && hipUp > this.rise * 0.8 && f.ankleRise > this.rise * 0.5) {
      this.air = true;
      this.airSince = f.t;
      this.landed.reset();
      return true;
    }
    return false;
  }

  get airborne() {
    return this.air;
  }

  reset() {
    this.hist = [];
    this.air = false;
  }
}

/**
 * Jumping jack: open (arms up, feet apart) then closed (arms down, feet together) is one jack. Seated: the
 * arms alone (wide and up, then down).
 */
export class JackMachine {
  private state: "closed" | "open" = "closed";
  private openD = new Dwell();
  private closeD = new Dwell();
  private refractoryUntil = 0;

  constructor(private seated = false) {}

  update(f: Features): boolean {
    const armsUp = f.wristUpL > -0.2 && f.wristUpR > -0.2;
    const armsDown = f.wristDownL > 0 && f.wristDownR > 0;
    const open = this.seated ? f.wristUpL > 0.4 && f.wristUpR > 0.4 && f.wristSpread > 1.5 : armsUp && f.ankleSpread > 1.4;
    const closed = this.seated ? armsDown : armsDown && f.ankleSpread < 1.15;
    if (this.state === "closed") {
      if (f.t >= this.refractoryUntil && this.openD.check(open, f.t, 80)) {
        this.state = "open";
        this.closeD.reset();
      }
      return false;
    }
    if (!this.closeD.check(closed, f.t, 80)) return false;
    this.state = "closed";
    this.openD.reset();
    this.refractoryUntil = f.t + 250;
    return true;
  }
}

/** Both arms raised high above the head, then lowered again. */
export class RaiseMachine {
  private up = false;
  private upD = new Dwell();
  private downD = new Dwell();
  private refractoryUntil = 0;

  update(f: Features): boolean {
    if (!this.up) {
      if (f.t >= this.refractoryUntil && this.upD.check(f.wristUpL > 0.5 && f.wristUpR > 0.5, f.t)) {
        this.up = true;
        this.downD.reset();
        this.refractoryUntil = f.t + 400;
        return true;
      }
      return false;
    }
    if (this.downD.check(f.wristDownL > -0.1 && f.wristDownR > -0.1, f.t)) {
      this.up = false;
      this.upD.reset();
    }
    return false;
  }
}

/** A punch: one wrist pushed out in front at chest height (towards the camera), then pulled back. */
export class PunchMachine {
  private out: "L" | "R" | null = null;
  private outD = new Dwell();
  private backD = new Dwell();
  private refractoryUntil = 0;

  update(f: Features): boolean {
    if (!this.out) {
      const l = f.reachL > 0.55 && f.chestL, r = f.reachR > 0.55 && f.chestR;
      if (f.t >= this.refractoryUntil && this.outD.check(l || r, f.t, 60)) {
        this.out = f.reachL >= f.reachR ? "L" : "R";
        this.backD.reset();
        this.refractoryUntil = f.t + 300;
        return true;
      }
      return false;
    }
    const reach = this.out === "L" ? f.reachL : f.reachR;
    if (this.backD.check(reach < 0.25, f.t, 100)) {
      this.out = null;
      this.outD.reset();
    }
    return false;
  }
}

/** Both hands on the head, held for a second: the pause gesture. */
export class HeadMachine {
  private hold = new Dwell();
  private armed = true;
  private refractoryUntil = 0;

  update(f: Features): boolean {
    if (!f.handsOnHead) {
      this.hold.reset();
      this.armed = true;
      return false;
    }
    if (this.armed && f.t >= this.refractoryUntil && this.hold.check(true, f.t, 1000)) {
      this.armed = false;
      this.refractoryUntil = f.t + 2500;
      return true;
    }
    return false;
  }
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round2 = (v: number) => Math.round(v * 100) / 100;
