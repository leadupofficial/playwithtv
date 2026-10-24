import { describe, expect, it } from "vitest";
import { HEAD, LANE_HALF, MAX_TIME, knocked, newLane, pinSpot, previewPath, rack, simulate, standingCount, stepLane, sweep, throwBall, type Shot } from "./physics";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) * 7919);
const rate = (shot: Shot, n = 20) => seeds(n).filter((s) => simulate(newLane(s), shot) === 10).length / n;
const avg = (shot: Shot, n = 20) => seeds(n).reduce((t, s) => t + simulate(newLane(s), shot), 0) / n;

describe("bowling lane physics", () => {
  it("racks ten pins on the standard triangle", () => {
    const lane = newLane(3);
    expect(lane.pins).toHaveLength(10);
    expect(pinSpot(1)).toEqual({ x: 0, y: HEAD });
    expect(pinSpot(7).x).toBeCloseTo(-0.457, 2);
    expect(pinSpot(10).x).toBeCloseTo(0.457, 2);
    expect(pinSpot(10).y).toBeGreaterThan(pinSpot(1).y);
    expect(standingCount(lane)).toBe(10);
  });

  it("is deterministic for a seed", () => {
    const shot = { x: 0.1, angle: 0.002, speed: 7.5, spin: -0.6 };
    const a = newLane(42), b = newLane(42);
    simulate(a, shot);
    simulate(b, shot);
    expect(a.pins.map((p) => [p.x, p.y, p.standing])).toEqual(b.pins.map((p) => [p.x, p.y, p.standing]));
  });

  it("a ball wide of the lane drops into the gutter and scores nothing", () => {
    const lane = newLane(1);
    expect(simulate(lane, { x: 0.45, angle: 0.02, speed: 8, spin: 0 })).toBe(0);
    expect(lane.ball.gutter).toBe(true);
    expect(lane.settled).toBe(true);
  });

  it("spin hooks the ball on the dry back end, not on the oil", () => {
    const straight = previewPath({ x: 0, angle: 0, speed: 8, spin: 0 }, HEAD);
    const left = previewPath({ x: 0, angle: 0, speed: 8, spin: -1 }, HEAD);
    const right = previewPath({ x: 0, angle: 0, speed: 8, spin: 1 }, HEAD);
    const at = (p: Array<{ x: number; y: number }>, y: number) => p.find((q) => q.y >= y)!.x;
    expect(Math.abs(at(left, 8))).toBeLessThan(0.03);               // still on the oil
    expect(at(left, HEAD - 0.5)).toBeLessThan(-0.12);               // hooked left at the pins
    expect(at(right, HEAD - 0.5)).toBeGreaterThan(0.12);
    expect(at(straight, HEAD - 0.5)).toBeCloseTo(0, 5);
    // a slower ball has more time on the dry boards, so it hooks more
    const slow = previewPath({ x: 0, angle: 0, speed: 6, spin: -1 }, HEAD);
    expect(at(slow, HEAD - 0.5)).toBeLessThan(at(left, HEAD - 0.5));
  });

  it("the direction aims the ball", () => {
    const p = previewPath({ x: 0, angle: 0.01, speed: 8, spin: 0 }, HEAD);
    expect(p[p.length - 1]!.x).toBeCloseTo(Math.tan(0.01) * HEAD, 1);
  });

  it("a pocket hit strikes most of the time; a hooking pocket ball even more", () => {
    expect(rate({ x: 0.05, angle: 0, speed: 8, spin: 0 })).toBeGreaterThanOrEqual(0.5);
    expect(rate({ x: 0.275, angle: 0, speed: 8, spin: -1 })).toBeGreaterThanOrEqual(0.7);
  });

  it("a dead-centre head-on hit rarely strikes (it leaves splits)", () => {
    expect(rate({ x: 0, angle: 0, speed: 8, spin: 0 })).toBeLessThan(0.2);
    expect(avg({ x: 0, angle: 0, speed: 8, spin: 0 })).toBeGreaterThan(6);
  });

  it("pins knock each other down: more fall than the ball touches", () => {
    let extra = 0;
    for (const s of seeds(10)) {
      const lane = newLane(s);
      const k = simulate(lane, { x: 0.05, angle: 0, speed: 8, spin: 0 });
      extra += k - lane.ball.touched.size;
    }
    expect(extra).toBeGreaterThan(20);
  });

  it("a thin hit on the edge pins knocks only a few", () => {
    const n = avg({ x: 0.36, angle: 0, speed: 8, spin: 0 }, 10);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5);
  });

  it("everything comes to rest within the time limit", () => {
    for (const s of seeds(10)) {
      const lane = newLane(s);
      throwBall(lane, { x: 0.1, angle: -0.003, speed: 9, spin: -1 });
      let t = 0;
      while (!lane.settled) { stepLane(lane, 1 / 60); t += 1 / 60; }
      expect(t).toBeLessThanOrEqual(MAX_TIME + 0.05);
      for (const p of lane.pins) if (!p.gone) expect(Math.abs(p.x)).toBeLessThan(0.8);
    }
  });

  it("the second ball plays the pins left standing; knocked pins are swept", () => {
    const lane = newLane(5);
    const first = simulate(lane, { x: 0.3, angle: 0, speed: 8, spin: 0 });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
    sweep(lane);
    expect(standingCount(lane)).toBe(10 - first);
    expect(knocked(lane)).toBe(0);
    const second = simulate(lane, { x: -0.1, angle: 0, speed: 8, spin: 0 });
    expect(second).toBeLessThanOrEqual(10 - first);
    rack(lane);
    expect(standingCount(lane)).toBe(10);
  });

  it("pins never end up outside the lane walls", () => {
    const lane = newLane(9);
    simulate(lane, { x: -0.2, angle: 0.004, speed: 9, spin: 1 });
    for (const p of lane.pins) if (!p.gone && p.standing) expect(Math.abs(p.x)).toBeLessThanOrEqual(LANE_HALF + 0.05);
  });
});
