/**
 * Beat timing for rhythm games (Beat Blade): when did a swing REALLY happen, in TV time?
 *
 * A packet from the phone takes 10–150 ms to reach the TV and that delay jitters, far more than a rhythm game's
 * ±45 ms "perfect" window. So the phone stamps each swing itself:
 *
 *   1. ClockSync (phone): NTP-style. The phone pings the TV over the direct link, the TV answers with its own
 *      performance.now(). From the fastest round trips the phone learns `tv = phone + offset` (±a few ms on Wi-Fi).
 *   2. The phone sends the swing's peak, converted to TV time, as an axis: `pk` = stamp wrapped every STAMP_PERIOD
 *      ms and scaled into [-1, 1] (axes are clamped), `pv` = 1 when the stamp is valid (synced).
 *   3. The TV unwraps it (`unwrapStamp`) to the full TV time and judges it against the beat (`judgeHit`).
 *   4. What no clock can see (the TV's own display lag, a slow sensor) is measured once per player by
 *      LatencyCalibrator: swing along to a metronome, the median error becomes that player's offset.
 *
 * Without the direct link (server relay) there is no stamp: the TV falls back to arrival time, and the
 * calibration absorbs the average delay (less precise, still playable on wide windows).
 * Pure (no DOM), tested in beat.test.ts.
 */

/** Stamps wrap every 8.192 s: far longer than any delay, and well inside float precision when scaled. */
export const STAMP_PERIOD = 8192;

/** TV time (ms) → the `pk` axis value in [-1, 1). */
export function encodeStamp(tvMs: number): number {
  const m = ((tvMs % STAMP_PERIOD) + STAMP_PERIOD) % STAMP_PERIOD;
  return (m / STAMP_PERIOD) * 2 - 1;
}

/**
 * The `pk` axis back to full TV time: the stamp nearest `now` (it arrives after the swing, so a stamp more than
 * `aheadMs` in the future must belong to the previous period).
 */
export function unwrapStamp(pk: number, now: number, aheadMs = 1000): number {
  const base = ((pk + 1) / 2) * STAMP_PERIOD;
  let t = base + STAMP_PERIOD * Math.round((now - base) / STAMP_PERIOD);
  if (t > now + aheadMs) t -= STAMP_PERIOD;
  return t;
}

export interface ClockSample { offset: number; rtt: number }

/** Phone side: learns `tvTime = phoneTime + offset` from ping/pong round trips. */
export class ClockSync {
  private samples: ClockSample[] = [];
  constructor(private keep = 16, private minSamples = 3) {}

  /** A pong: `sentAt` (phone clock, the ping), `tvAt` (TV clock, when it answered), `now` (phone clock, arrived). */
  add(sentAt: number, tvAt: number, now: number): void {
    const rtt = now - sentAt;
    if (!(rtt >= 0) || !Number.isFinite(tvAt)) return;
    // the TV answered somewhere inside the round trip: assume the middle
    this.samples.push({ offset: tvAt - (sentAt + rtt / 2), rtt });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get synced(): boolean {
    return this.samples.length >= this.minSamples;
  }

  /** The offset from the fastest recent round trip: the least room for asymmetric delay, so the most accurate. */
  get offset(): number {
    let best: ClockSample | undefined;
    for (const s of this.samples) if (!best || s.rtt < best.rtt) best = s;
    return best?.offset ?? 0;
  }

  /** Worst-case error of the offset: half the fastest round trip. */
  get uncertainty(): number {
    return this.samples.length ? Math.min(...this.samples.map((s) => s.rtt)) / 2 : Infinity;
  }

  /** Phone time → TV time, or null before enough samples. */
  tvTime(phoneMs: number): number | null {
    return this.synced ? phoneMs + this.offset : null;
  }

  reset(): void {
    this.samples = [];
  }
}

export type Judgement = "perfect" | "great" | "good" | "miss";
export interface HitWindows { perfect: number; great: number; good: number }
/** ± ms. Normal difficulty; Easy widens them, Hard narrows them (see BeatBlade). */
export const HIT_WINDOWS: HitWindows = { perfect: 45, great: 90, good: 140 };

/** How close a swing (TV time, already corrected by the player's calibration) landed to the beat. */
export function judgeHit(swingMs: number, beatMs: number, w: HitWindows = HIT_WINDOWS): Judgement {
  const d = Math.abs(swingMs - beatMs);
  return d <= w.perfect ? "perfect" : d <= w.great ? "great" : d <= w.good ? "good" : "miss";
}

/**
 * Per-player latency calibration: swing on a metronome's beats, feed each (swing − beat) error. The median
 * (robust to the odd early/late swing) is the player's offset; it is ready when enough swings agree.
 */
export class LatencyCalibrator {
  private errs: number[] = [];
  constructor(private need = 6, private maxSpread = 60, private maxAbs = 500) {}

  /** Ignores wild swings (> maxAbs from the beat: a missed beat, not a delay). */
  add(errMs: number): void {
    if (Number.isFinite(errMs) && Math.abs(errMs) <= this.maxAbs) this.errs.push(errMs);
  }

  get count(): number {
    return this.errs.length;
  }

  get offset(): number {
    return median(this.errs);
  }

  /** Spread of the swings: median distance from the median (MAD). */
  get spread(): number {
    const m = this.offset;
    return median(this.errs.map((e) => Math.abs(e - m)));
  }

  get ready(): boolean {
    return this.errs.length >= this.need && this.spread <= this.maxSpread;
  }

  reset(): void {
    this.errs = [];
  }
}

function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2;
}
