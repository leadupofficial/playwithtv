import { MotionEngine, type Gesture, type MotionFrame, type MotionSettings, type RawSample } from "./engine.js";
import { type Vec3, v } from "./vec.js";

/** A recorded sensor session (the phone's sensor lab exports this) used as a test fixture. */
export interface MotionTrace {
  version: 1;
  /** Free text: phone model, browser, how it was held, what the person did. */
  note: string;
  synthetic?: boolean;
  samples: RawSample[];
}

export interface Replay { gestures: Gesture[]; last: MotionFrame; frames: MotionFrame[] }

/** Runs a trace through a fresh engine (calibrating on the first sample). */
export function replay(trace: MotionTrace, settings: Partial<MotionSettings> = {}): Replay {
  const e = new MotionEngine(settings);
  const gestures: Gesture[] = [];
  const frames: MotionFrame[] = [];
  for (const s of trace.samples) {
    gestures.push(...e.push(s));
    frames.push(e.frame(s.t));
  }
  return { gestures, frames, last: frames[frames.length - 1]! };
}

/**
 * Builds synthetic traces for tests: a pose (gravity direction) over time plus optional movement bursts.
 * Synthetic traces are labelled as such; they check the maths, real recordings check real phones.
 */
export class TraceBuilder {
  private samples: RawSample[] = [];
  private t = 0;
  constructor(private hz = 60, private withLinear = true, private withRotation = true) {}

  /** Holds a pose for `ms`, with optional sensor noise (m/s²). */
  hold(gravityUp: Vec3, ms: number, noise = 0) {
    const step = 1000 / this.hz;
    for (let x = 0; x < ms; x += step) {
      const j = () => (noise ? (Math.sin(this.t * 0.37 + x) * noise) : 0);
      this.add(v(gravityUp.x + j(), gravityUp.y + j(), gravityUp.z + j()), v(0, 0, 0), v(0, 0, 0));
    }
    return this;
  }

  /** A movement burst along `dir` (screen axes) peaking at `peak` m/s², then the opposite deceleration. */
  burst(gravityUp: Vec3, dir: Vec3, peak: number, ms = 160) {
    const step = 1000 / this.hz;
    for (let x = 0; x < ms; x += step) {
      const p = x / ms;
      const a = Math.sin(p * Math.PI * 2) * peak; // accelerate then brake
      this.add(v(gravityUp.x + dir.x * a, gravityUp.y + dir.y * a, gravityUp.z + dir.z * a), v(dir.x * a, dir.y * a, dir.z * a), v(0, 0, 0));
    }
    return this;
  }

  /** A quick rotation around the screen axis (deg/s peak). */
  spin(gravityUp: Vec3, peakDegPerS: number, ms = 160) {
    const step = 1000 / this.hz;
    for (let x = 0; x < ms; x += step) {
      this.add(gravityUp, v(0, 0, 0), v(0, 0, Math.sin((x / ms) * Math.PI) * peakDegPerS));
    }
    return this;
  }

  /** One isolated spike (a knock): a single sample far above any threshold. */
  spike(gravityUp: Vec3, dir: Vec3, peak: number) {
    this.add(v(gravityUp.x + dir.x * peak, gravityUp.y + dir.y * peak, gravityUp.z + dir.z * peak), v(dir.x * peak, dir.y * peak, dir.z * peak), v(0, 0, 0));
    return this;
  }

  private add(gravity: Vec3, linear: Vec3, rotation: Vec3) {
    this.samples.push({ t: this.t, gravity, linear: this.withLinear ? linear : null, rotation: this.withRotation ? rotation : null });
    this.t += 1000 / this.hz;
  }

  build(note: string): MotionTrace {
    return { version: 1, note, synthetic: true, samples: this.samples };
  }
}

/** Gravity "up" vector (m/s², screen axes) for a phone rotated by roll (steering, + right) and pitch (+ top away). */
export function pose(rollDeg: number, pitchDeg: number, base: "upright" | "flat" = "upright"): Vec3 {
  const r = (rollDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const g = 9.81;
  if (base === "upright") return v(-Math.sin(r) * Math.cos(p) * g, Math.cos(r) * Math.cos(p) * g, Math.sin(p) * g);
  // lying flat, screen up, top edge pointing at the TV
  return v(-Math.sin(r) * g, -Math.sin(p) * Math.cos(r) * g, Math.cos(p) * Math.cos(r) * g);
}
