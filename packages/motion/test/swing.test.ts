import { describe, expect, it } from "vitest";
import { ControlReader, GESTURE_SCALE, SwingDetector, TraceBuilder, pose, replay, v } from "../src/index.js";

const UP = pose(0, 0);
const swings = (r: ReturnType<typeof replay>) => r.gestures.filter((g) => g.kind === "swing");

describe("swing (bat-style) detection", () => {
  it("is off by default, so other games see exactly the gestures they always did", () => {
    const r = replay(new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), 24).hold(UP, 400).build("sideways swing"));
    expect(swings(r)).toEqual([]);
    expect(r.gestures.map((g) => g.kind)).toEqual(["flick-right"]);
  });

  it("fires once per swing, in any direction, timed at the peak", () => {
    for (const dir of [v(1, 0, 0), v(-1, 0, 0), v(0, 0, -1), v(0.7, 0.7, 0)]) {
      const t = new TraceBuilder().hold(UP, 300).burst(UP, dir, 24).hold(UP, 500).build("swing");
      const r = replay(t, { swing: true });
      const s = swings(r);
      expect(s.length).toBe(1);
      // the burst starts at ~300 ms and peaks a quarter of the way through its 160 ms (sin): ~340 ms
      expect(s[0]!.t).toBeGreaterThan(320);
      expect(s[0]!.t).toBeLessThan(365);
    }
  });

  it("strength follows how hard the swing was", () => {
    const at = (peak: number) => swings(replay(new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), peak).hold(UP, 400).build("s"), { swing: true }))[0]!.strength;
    expect(at(14)).toBeLessThan(1.4);
    expect(at(30)).toBeGreaterThan(2.3);
    expect(at(36)).toBeGreaterThan(at(24));
  });

  it("ignores gentle sways and a single knock", () => {
    const r = replay(new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), 8).hold(UP, 300).spike(UP, v(0, 0, -1), 50).hold(UP, 400).build("sway, knock"), { swing: true });
    expect(swings(r)).toEqual([]);
  });

  it("needs the phone to settle between swings (no double swing from the follow-through)", () => {
    const b = new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), 24).burst(UP, v(-1, 0, 0), 24).hold(UP, 600);
    expect(swings(replay(b.build("swing + swing back"), { swing: true })).length).toBe(1);
    const two = new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), 24).hold(UP, 600).burst(UP, v(1, 0, 0), 24).hold(UP, 400);
    expect(swings(replay(two.build("two swings"), { swing: true })).length).toBe(2);
  });

  it("counts a fast wrist turn (gyroscope) as a swing too", () => {
    const d = new SwingDetector();
    const hits = [];
    for (let t = 0; t < 600; t += 16) {
      const rot = t > 200 && t < 330 ? Math.sin(((t - 200) / 130) * Math.PI) * 600 : 0;
      const h = d.push(v(0, 0, 0), v(0, 0, rot), t);
      if (h) hits.push(h);
    }
    expect(hits.length).toBe(1);
    expect(hits[0]!.strength).toBeGreaterThan(1.4);
  });

  it("travels to the TV as axes.gs with its tap", () => {
    const r = new ControlReader();
    r.update({ axes: { m: 0.25 }, taps: { swing: 0 } });
    expect(r.update({ axes: { m: 0.25, gs: 2.6 / GESTURE_SCALE }, taps: { swing: 1 } })).toEqual(["swing"]);
    expect(r.gesture).toBeCloseTo(2.6);
  });
});
