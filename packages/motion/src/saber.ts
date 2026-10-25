/**
 * Saber cuts for rhythm games (Beat Blade): the phone is the hilt of a light saber.
 *
 * With a gyroscope (almost every phone), a cut is a fast turn of the wrist, read from the rotation rate in the
 * calibrated frame (right, up, towards the player):
 *   around "right"            positive = the blade tip rises       → cut UP,   negative → cut DOWN
 *   around "towards player"   positive = the tip swings left       → cut LEFT  (a sideways slash, phone upright)
 *   around "up"               positive = the tip swings left       → cut LEFT  (the same slash, phone held flat-ish)
 * Without one, the accelerometer's first push decides the direction (the arm then brakes the other way, so
 * only the onset counts). Some phones without a gyroscope report a rotation rate of exactly zero, so the
 * gyroscope is trusted only once it has been seen moving (any real wrist turn is far above 60 deg/s).
 *
 * A cut is reported at its PEAK (the moment the blade is fastest: where it meets the block), not when it was
 * recognised, which is what rhythm judging needs (beat.ts stamps it in TV time). After a cut the detector
 * re-arms as soon as the wrist slows, so a down-up-down pattern on half beats reads as three cuts.
 * Pure (no DOM), tested with synthetic swings in test/saber.test.ts.
 */
import type { Vec3 } from "./vec.js";

export type CutDir = "up" | "down" | "left" | "right";
export interface Cut { dir: CutDir; strength: number; t: number }

export interface SaberSettings {
  /** deg/s: a deliberate cut. Real cuts peak at 300–1500 deg/s; a wobble stays well under 150. */
  rotThreshold: number;
  /** m/s², the accelerometer fallback. */
  accThreshold: number;
  /** A cut longer than this is cut off (and reported). */
  maxMs: number;
  /** No new cut this soon after the last one's peak. */
  refractoryMs: number;
}

export const SABER_DEFAULTS: SaberSettings = { rotThreshold: 220, accThreshold: 9, maxMs: 260, refractoryMs: 110 };

interface Pending { start: number; peak: number; peakT: number; sx: number; sy: number; hits: number }

export class SaberDetector {
  settings: SaberSettings;
  private armed = true;
  private pending: Pending | null = null;
  private lastPeak = -1e9;
  private gyroSeen = false;
  constructor(settings: Partial<SaberSettings> = {}) {
    this.settings = { ...SABER_DEFAULTS, ...settings };
  }

  /**
   * One sample. `rot`: rotation rate (deg/s) projected on (right, up, towards player); `acc`: linear
   * acceleration (m/s²) on (right, up, towards the TV). Returns a finished cut, if any.
   */
  push(rot: Vec3 | null, acc: Vec3, t: number): Cut | null {
    // signed swing velocity: x = rightwards, y = upwards (both "blade tip" directions)
    let x: number, y: number, th: number;
    if (rot && !this.gyroSeen && Math.hypot(rot.x, rot.y, rot.z) > 60) this.gyroSeen = true;
    if (rot && this.gyroSeen) {
      y = rot.x;
      x = -(rot.z + rot.y);
      th = this.settings.rotThreshold;
    } else {
      x = acc.x;
      y = acc.y;
      th = this.settings.accThreshold;
    }
    const mag = Math.hypot(x, y);
    const p = this.pending;
    if (p) {
      if (mag > p.peak) { p.peak = mag; p.peakT = t; }
      // with a gyroscope the whole cut points one way; with the accelerometer only its onset does
      if ((rot && this.gyroSeen) || t - p.start < 50) { p.sx += x; p.sy += y; }
      if (mag > th * 0.5) p.hits++;
      if (mag < th * 0.45 || t - p.start > this.settings.maxMs) {
        this.pending = null;
        this.armed = mag < th * 0.45;
        if (p.hits < 2 && t - p.start < 30) return null; // a lone spike (a knock), not a cut
        this.lastPeak = p.peakT;
        const dir: CutDir = Math.abs(p.sy) >= Math.abs(p.sx) ? (p.sy > 0 ? "up" : "down") : p.sx > 0 ? "right" : "left";
        return { dir, strength: Math.round((p.peak / th) * 100) / 100, t: p.peakT };
      }
      return null;
    }
    if (!this.armed) {
      if (mag < th * 0.45) this.armed = true;
      return null;
    }
    if (mag > th && t - this.lastPeak > this.settings.refractoryMs) {
      this.pending = { start: t, peak: mag, peakT: t, sx: x, sy: y, hits: 1 };
    }
    return null;
  }

  reset() {
    this.armed = true;
    this.pending = null;
    this.lastPeak = -1e9;
  }
}
