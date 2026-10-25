/**
 * kit3d/governor: keeps a real-time game smooth on whatever machine it lands on. It watches frame times and
 * steps quality DOWN quickly when the frame rate sags (ambient occlusion off, then lower render scale, then no
 * bloom), and back UP slowly when there is headroom, without oscillating. Pure logic, unit-tested; the cinematic
 * renderer (cinematic.ts) applies the levels.
 *
 *   const g = new FrameGovernor(LEVELS.length);
 *   every frame: const next = g.sample(frameMs); if (next !== null) apply(LEVELS[next]);
 */

export interface GovernorLevel {
  /** Render-scale multiplier on the profile's resolution (1 = full). */
  scale: number;
  /** Keep ambient occlusion (only matters where the profile has it). */
  ao: boolean;
  /** Keep bloom. */
  bloom: boolean;
}

/** From best to cheapest. Shed the effect that costs most for the least visible loss first. */
export const LEVELS: readonly GovernorLevel[] = [
  { scale: 1, ao: true, bloom: true },
  { scale: 1, ao: false, bloom: true },
  { scale: 0.85, ao: false, bloom: true },
  { scale: 0.75, ao: false, bloom: true },
  { scale: 0.67, ao: false, bloom: true },
  // floor: below ~720p the picture turns soft on a TV, and a game that is still slow here is limited by draw
  // calls or CPU, not pixels; such a machine should be on the lite tier instead
  { scale: 0.67, ao: false, bloom: false },
];

export interface GovernorOptions {
  /** Below this average fps over a window, step down. */
  low?: number;
  /** At or above this average fps for `upWindows` windows in a row, try one step up. */
  high?: number;
  /** Measurement window, ms. */
  windowMs?: number;
  upWindows?: number;
  /** Windows ignored at the start (shader compilation, texture uploads, the first seconds of a scene). */
  warmupWindows?: number;
  /** Consecutive slow windows before stepping down (a single hitch never costs quality). */
  downWindows?: number;
}

export class FrameGovernor {
  level = 0;
  /** Last measured average fps (for debug displays). */
  fps = 0;
  private low: number;
  private high: number;
  private windowMs: number;
  private upWindows: number;
  private acc = 0;
  private frames = 0;
  private good = 0;
  private settle = 0;
  /** A level that failed right after we stepped up to it (index) is not retried for a while (doubling). */
  private blocked = -1;
  private blockWindows = 0;
  private blockLen = 8;
  private justRaised = 0;
  private bad = 0;
  private downWindows: number;

  constructor(readonly levels: number, o: GovernorOptions = {}) {
    this.low = o.low ?? 50;
    this.high = o.high ?? 57;
    this.windowMs = o.windowMs ?? 1000;
    this.upWindows = o.upWindows ?? 5;
    this.downWindows = o.downWindows ?? 2;
    this.settle = o.warmupWindows ?? 3;
  }

  /**
   * Feeds one frame's duration (ms). Returns the new level index when it changes, else null. Gaps over 250 ms
   * (tab hidden, loading hitch) are ignored.
   */
  sample(frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > 250) return null;
    this.acc += frameMs;
    this.frames++;
    if (this.acc < this.windowMs) return null;
    const fps = (this.frames * 1000) / this.acc;
    this.fps = fps;
    this.acc = 0;
    this.frames = 0;
    if (this.blockWindows > 0 && --this.blockWindows === 0) this.blocked = -1;
    if (this.settle > 0) {
      this.settle--;
      return null;
    }
    const slow = fps < this.low;
    this.bad = slow ? this.bad + 1 : 0;
    // a step up that immediately fails is undone at once; otherwise wait for `downWindows` slow windows
    if (slow && this.level < this.levels - 1 && (this.bad >= this.downWindows || this.justRaised > 0)) {
      this.bad = 0;
      if (this.justRaised > 0) { // the step up did not hold: stay below it for longer next time
        this.blocked = this.level;
        this.blockWindows = this.blockLen;
        this.blockLen = Math.min(120, this.blockLen * 2);
      }
      this.level++;
      this.good = 0;
      this.settle = 1; // the next window still holds frames from before the change
      this.justRaised = 0;
      return this.level;
    }
    if (this.justRaised > 0) this.justRaised--;
    if (fps >= this.high) {
      if (++this.good >= this.upWindows && this.level - 1 > this.blocked) {
        this.level--;
        this.good = 0;
        this.settle = 1;
        this.justRaised = 3;
        return this.level;
      }
    } else this.good = 0;
    return null;
  }
}
