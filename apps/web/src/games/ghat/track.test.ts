import { describe, expect, it } from "vitest";
import { HAIRPIN_GHAT } from "./course";
import { STEP, buildTrack, closestApproach, curvAhead, frameAt, toWorld, wrapAngle, wrapS } from "./track";

const t = buildTrack(HAIRPIN_GHAT);

describe("Hairpin Ghat track", () => {
  it("is a ~1.5 km closed loop whose samples are evenly spaced", () => {
    expect(t.length).toBeGreaterThan(1300);
    expect(t.length).toBeLessThan(1700);
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const step = Math.hypot(t.x[j]! - t.x[i]!, t.z[j]! - t.z[i]!);
      expect(step).toBeGreaterThan(STEP * 0.85);
      expect(step).toBeLessThan(STEP * 1.15);
    }
  });

  it("is smooth: no kinks in heading or elevation, hairpins no tighter than ~20 m", () => {
    for (let i = 0; i < t.n; i++) {
      expect(Math.abs(t.curv[i]!)).toBeLessThan(1 / 19);
      const dy = Math.abs(t.y[(i + 1) % t.n]! - t.y[i]!);
      expect(dy).toBeLessThan(0.85); // ≤ 42 % even on the jump ramps
    }
    // it really has two hairpins (≈ 180° turns)
    const turns = HAIRPIN_GHAT.segments.filter((s) => Math.abs(s.turn ?? 0) >= 180);
    expect(turns).toHaveLength(2);
  });

  it("never runs one leg of the road over another", () => {
    const maxHw = Math.max(...t.hw);
    expect(closestApproach(t).dist).toBeGreaterThan(maxHw * 2 + 12);
  });

  it("descends a real ghat and climbs back (≥ 30 m of elevation)", () => {
    expect(Math.min(...t.y)).toBeLessThan(-30);
    expect(Math.abs(t.y[0]!)).toBeLessThan(0.5);
  });

  it("puts +d on the right of the direction of travel", () => {
    const f = frameAt(t, 50);
    const right = toWorld(t, 50, 3);
    // forward = (sin h, cos h); right = forward × up = (-cos h, sin h)
    const fx = Math.sin(f.heading), fz = Math.cos(f.heading);
    const cross = fx * (right.z - f.z) - fz * (right.x - f.x); // > 0: the point is to the right (y-up, three.js)
    expect(cross).toBeGreaterThan(0);
    expect(Math.hypot(right.x - f.x, right.z - f.z)).toBeCloseTo(3, 3);
  });

  it("wraps s and angles, and sees corners coming", () => {
    expect(wrapS(t, -1)).toBeCloseTo(t.length - 1);
    expect(wrapS(t, t.length * 2 + 5)).toBeCloseTo(5, 3);
    expect(Math.abs(wrapAngle(Math.PI * 3))).toBeCloseTo(Math.PI, 5);
    expect(wrapAngle(0.5 + Math.PI * 4)).toBeCloseTo(0.5, 5);
    const hairpin = HAIRPIN_GHAT.segments.slice(0, 3).reduce((a, s) => a + s.len, 0);
    expect(curvAhead(t, hairpin - 30, 60)).toBeGreaterThan(1 / 40); // hairpin 1 turns left
  });
});
