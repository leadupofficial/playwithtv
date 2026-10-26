import { describe, expect, it } from "vitest";
import { MotionEngine, SaberDetector, v, type CutDir, type RawSample } from "../src/index.js";

/** A cut: rotation rate rises and falls like a bell over `ms`, peaking at t0 + ms/2. */
function cutSamples(axis: { x?: number; y?: number; z?: number }, peak: number, t0: number, ms = 140, hz = 100) {
  const out: Array<{ rot: { x: number; y: number; z: number }; t: number }> = [];
  for (let t = 0; t <= ms; t += 1000 / hz) {
    const k = Math.sin((Math.PI * t) / ms) ** 2 * peak;
    out.push({ rot: { x: (axis.x ?? 0) * k, y: (axis.y ?? 0) * k, z: (axis.z ?? 0) * k }, t: t0 + t });
  }
  for (let t = ms + 10; t <= ms + 80; t += 10) out.push({ rot: { x: 0, y: 0, z: 0 }, t: t0 + t });
  return out;
}

const run = (d: SaberDetector, samples: ReturnType<typeof cutSamples>) =>
  samples.map((s) => d.push(s.rot, v(0, 0, 0), s.t)).filter((c) => c !== null);

describe("SaberDetector (gyroscope)", () => {
  const cases: Array<[CutDir, { x?: number; y?: number; z?: number }]> = [
    ["up", { x: 1 }], ["down", { x: -1 }], ["left", { z: 1 }], ["right", { z: -1 }], ["left", { y: 1 }], ["right", { y: -0.7, z: -0.5 }],
  ];
  for (const [dir, axis] of cases) {
    it(`reads ${dir} from ${JSON.stringify(axis)}`, () => {
      const cuts = run(new SaberDetector(), cutSamples(axis, 700, 1000));
      expect(cuts).toHaveLength(1);
      expect(cuts[0]!.dir).toBe(dir);
    });
  }
  it("reports the peak's time, not the end of the cut", () => {
    const [c] = run(new SaberDetector(), cutSamples({ x: -1 }, 900, 5000, 160));
    expect(Math.abs(c!.t - 5080)).toBeLessThanOrEqual(10);
    expect(c!.strength).toBeGreaterThan(3);
  });
  it("sends the cut just past its peak, not when the wrist stops", () => {
    // a 240 ms cut peaking at 120 ms: it used to arrive at ~230 ms
    const d = new SaberDetector();
    const at = cutSamples({ z: -1 }, 600, 0, 240).find((s) => d.push(s.rot, v(0, 0, 0), s.t))!.t;
    expect(at).toBeLessThanOrEqual(160);
  });
  it("reads a relaxed cut (peak 200 deg/s) without a hard swing", () => {
    expect(run(new SaberDetector(), cutSamples({ x: 1 }, 200, 0, 160)).map((c) => c.dir)).toEqual(["up"]);
  });
  it("ignores wobbles below the threshold", () => {
    expect(run(new SaberDetector(), cutSamples({ x: 1, z: 1 }, 120, 0))).toHaveLength(0);
  });
  it("reads a fast down-up-down-up pattern (half beats at 130 bpm) as four cuts", () => {
    const d = new SaberDetector();
    const s = [-1, 1, -1, 1].flatMap((sign, i) => cutSamples({ x: sign }, 650, i * 231, 150).slice(0, 16));
    const cuts = run(d, s);
    expect(cuts.map((c) => c.dir)).toEqual(["down", "up", "down", "up"]);
  });
  it("is not fooled by a lone spike", () => {
    const d = new SaberDetector();
    expect(d.push({ x: 2000, y: 0, z: 0 }, v(0, 0, 0), 0)).toBeNull();
    expect(d.push({ x: 0, y: 0, z: 0 }, v(0, 0, 0), 10)).toBeNull();
  });
});

describe("SaberDetector (no gyroscope: accelerometer onset)", () => {
  it("falls back to the accelerometer when the gyroscope only ever reads zero", () => {
    const d = new SaberDetector();
    const out = [];
    for (let t = 0; t <= 300; t += 10) {
      const a = t < 120 ? 18 * Math.sin((Math.PI * t) / 120) : 0;
      const c = d.push({ x: 0, y: 0, z: 0 }, v(0, a, 0), t);
      if (c) out.push(c.dir);
    }
    expect(out).toEqual(["up"]);
  });
  it("takes the direction from the first push, not the braking afterwards", () => {
    const d = new SaberDetector();
    const out = [];
    for (let t = 0; t <= 300; t += 10) {
      // push left hard for 80 ms, then brake (accelerate right) for 80 ms
      const a = t < 80 ? -20 * Math.sin((Math.PI * t) / 80) : t < 160 ? 16 * Math.sin((Math.PI * (t - 80)) / 80) : 0;
      const c = d.push(null, v(a, 0, 0), t);
      if (c) out.push(c);
    }
    expect(out.map((c) => c.dir)).toEqual(["left"]);
  });
});

describe("MotionEngine saber mode", () => {
  it("turns gyroscope cuts into flick gestures at the peak, and drops accelerometer flicks", () => {
    const e = new MotionEngine({ saber: true });
    const g = v(0, 9.81, 0); // upright
    const out = [];
    for (let t = 0; t <= 400; t += 10) {
      const k = t >= 100 && t <= 240 ? Math.sin((Math.PI * (t - 100)) / 140) ** 2 : 0;
      const s: RawSample = { t, gravity: g, linear: v(0, -14 * k, 0), rotation: v(-800 * k, 0, 0) };
      out.push(...e.push(s));
    }
    expect(out.map((x) => x.kind)).toEqual(["flick-down"]);
    expect(Math.abs(out[0]!.t - 170)).toBeLessThanOrEqual(10);
  });
});
