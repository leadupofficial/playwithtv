import { type Vec3, len } from "./vec.js";

/**
 * Swing detection: the phone swung like a bat, a racket or a sword. Direction does not matter (players hold the
 * phone every which way); what matters is WHEN the swing peaked and HOW HARD it was. Uses linear acceleration
 * and, when there is a gyroscope, the rotation rate (a bat swing turns the wrist fast).
 *
 *   const sw = new SwingDetector();
 *   const s = sw.push(linear, rotation, t);   // per sensor sample
 *   if (s) …                                  // { strength, t: time of the peak, ms }
 *
 * strength = peak / threshold: ~1.2 a gentle push of the bat, 2 a proper swing, 3+ a full slog.
 * Pure (no DOM), so it is tested on synthetic and recorded traces.
 */
export interface SwingSettings {
  /** Linear acceleration (m/s²) that starts a swing. */
  threshold: number;
  /** Rotation rate (deg/s) counted as one m/s² of swing (rotation / this, compared with the threshold). */
  degPerUnit: number;
  /** After a swing, the phone must settle before the next one; and nothing for this long. */
  cooldownMs: number;
}

export const SWING_DEFAULTS: SwingSettings = { threshold: 12, degPerUnit: 30, cooldownMs: 450 };

export interface SwingHit {
  strength: number;
  /** Sample time of the peak (the moment the bat would meet the ball). */
  t: number;
  /** How long the swing took from its start to the peak. */
  ms: number;
}

const QUIET = 0.35;
const MAX_MS = 260;

export class SwingDetector {
  settings: SwingSettings;
  private armed = true;
  private quietSince = 0;
  private cooldown = 0;
  private cur: { start: number; peak: number; peakT: number; hits: number } | null = null;
  private rate = 0;
  private lastT = 0;

  constructor(settings: Partial<SwingSettings> = {}) {
    this.settings = { ...SWING_DEFAULTS, ...settings };
  }

  /** Feeds one sample (linear acceleration in any frame, rotation in deg/s or null). Returns a finished swing. */
  push(linear: Vec3, rotation: Vec3 | null, t: number): SwingHit | null {
    const dt = this.lastT ? Math.max(1, t - this.lastT) : 16;
    this.rate = this.rate ? this.rate * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    this.lastT = t;
    const th = this.settings.threshold;
    const mag = Math.max(len(linear), rotation ? len(rotation) / this.settings.degPerUnit : 0);
    if (!this.armed) {
      if (mag < th * QUIET) {
        this.quietSince ||= t;
        if (t - this.quietSince >= 60) this.armed = true;
      } else this.quietSince = 0;
      return null;
    }
    const c = this.cur;
    if (c) {
      if (mag > c.peak) {
        c.peak = mag;
        c.peakT = t;
      }
      if (mag > th * 0.6) c.hits++;
      // finished once it has clearly come off the peak (or after a long, slow swing)
      if (mag > c.peak * 0.45 && t - c.start < MAX_MS) return null;
      this.cur = null;
      const needed = this.rate < 30 ? 1 : 2; // a lone spike (a knock) is not a swing; slow sensors get one sample
      if (c.hits < needed) return null;
      this.armed = false;
      this.quietSince = 0;
      this.cooldown = t + this.settings.cooldownMs;
      return { strength: Math.round((c.peak / th) * 100) / 100, t: c.peakT, ms: c.peakT - c.start };
    }
    if (t < this.cooldown || mag <= th) return null;
    this.cur = { start: t, peak: mag, peakT: t, hits: 1 };
    return null;
  }
}
