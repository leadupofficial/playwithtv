/**
 * Test hook: a synthetic player in front of the camera. Browser tests have a fake camera (an empty test
 * pattern, nobody in it), so they set `window.__fakePose` (or open the page with `?fake-pose=1`) and queue
 * moves: `__fakePose.queue.push("squat", "jump")`. The landmarks go through the same tracker as real ones.
 *
 * Harmless in production: it is off unless someone sets it in their own browser, and then it can only make
 * their own controller send moves, exactly like pressing the on-screen buttons.
 */
import type { Landmark } from "./poseActions";
import type { PoseSource } from "./poseSource";
import { bodyLandmarks, moveTimeline, seeded, type BodyPose, type Move } from "./synthetic";

export interface FakePoseControl {
  /** Moves still to play, in order. */
  queue: Move[];
  /** The resting pose between moves; null = nobody in view. */
  base: BodyPose | null;
  /** Moves played so far. */
  done: number;
}

type W = { __fakePose?: FakePoseControl };

export function fakePoseControl(): FakePoseControl | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as W;
  if (!w.__fakePose && new URLSearchParams(location.search).get("fake-pose") === "1") w.__fakePose = { queue: [], base: {}, done: 0 };
  const c = w.__fakePose;
  if (c) {
    c.queue ??= [];
    c.done ??= 0;
    if (c.base === undefined) c.base = {};
  }
  return c ?? null;
}

export class FakePoseSource implements PoseSource {
  readonly kind = "fake";
  readonly delegate = "synthetic";
  private current: { move: Move; start: number; ms: number; at(t: number): BodyPose } | null = null;
  private rnd = seeded(42);

  constructor(private ctl: FakePoseControl) {}

  detect(_video: HTMLVideoElement, t: number): Landmark[] | null {
    const base = this.ctl.base;
    if (this.current && t - this.current.start >= this.current.ms) {
      this.current = null;
      this.ctl.done++;
    }
    if (!this.current && this.ctl.queue.length) {
      const move = this.ctl.queue.shift()!;
      this.current = { move, start: t, ...moveTimeline(move, base ?? {}) };
    }
    const pose = this.current ? this.current.at(t - this.current.start) : base;
    return pose ? bodyLandmarks({ noise: 0.002, ...pose }, this.rnd) : null;
  }
}
