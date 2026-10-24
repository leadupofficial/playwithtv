import { describe, expect, it } from "vitest";
import {
  BALL_R, DIVE_TIME, GOAL_H, HALF_W, POST_R, SPOT, aimToGoal, ballAt, flightTime, keeperBody, makeShot, resolve, segDist,
  type Capsule,
} from "./geometry";

const AWAY: Capsule = { a: { x: 50, y: 0 }, b: { x: 50, y: 1 }, r: 0.1 }; // no keeper in the way
const still = (() => { let i = 0; return () => (i++ % 2 === 0 ? Math.exp(-0.5) : 0.25); })(); // √(-2 ln e^-0.5)=1, cos(π/2)=0 → no error

describe("goal, save and woodwork geometry", () => {
  it("a ball inside the frame is a goal; outside is wide or over", () => {
    expect(resolve({ x: 0, y: 1 }, AWAY).outcome).toBe("goal");
    expect(resolve({ x: HALF_W - 0.2, y: GOAL_H - 0.2 }, AWAY)).toEqual({ outcome: "goal", woodwork: false });
    expect(resolve({ x: HALF_W + 0.5, y: 1 }, AWAY).outcome).toBe("wide");
    expect(resolve({ x: -HALF_W - 0.5, y: 0.3 }, AWAY).outcome).toBe("wide");
    expect(resolve({ x: 0, y: GOAL_H + 0.5 }, AWAY).outcome).toBe("over");
  });

  it("clipping the inside of a post goes in; the outside of the post stays out", () => {
    expect(resolve({ x: HALF_W - 0.05, y: 1 }, AWAY)).toEqual({ outcome: "goal", woodwork: true });
    expect(resolve({ x: HALF_W + 0.1, y: 1 }, AWAY)).toEqual({ outcome: "post", woodwork: true });
    expect(resolve({ x: -(HALF_W + 0.1), y: 1 }, AWAY)).toEqual({ outcome: "post", woodwork: true });
    expect(resolve({ x: HALF_W + POST_R * 2 + BALL_R + 0.02, y: 1 }, AWAY).outcome).toBe("wide");
  });

  it("the crossbar: under it in off the bar, on top of it is 'bar'", () => {
    expect(resolve({ x: 1, y: GOAL_H - 0.03 }, AWAY)).toEqual({ outcome: "goal", woodwork: true });
    expect(resolve({ x: 1, y: GOAL_H + 0.12 }, AWAY)).toEqual({ outcome: "bar", woodwork: true });
  });

  it("any keeper touch is a save, even on a ball heading wide", () => {
    const keeper = keeperBody(null, 0);
    expect(resolve({ x: 0.3, y: 1 }, keeper).outcome).toBe("save");
    expect(resolve({ x: 4.6, y: 1 }, { a: { x: 2.9, y: 1 }, b: { x: 3.2, y: 1 }, r: 0.4 }).outcome).toBe("wide");
    expect(resolve({ x: 3.8, y: 1 }, { a: { x: 3.4, y: 1 }, b: { x: 3.6, y: 1 }, r: 0.3 }).outcome).toBe("save");
  });

  it("measures distance to a segment", () => {
    expect(segDist({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(1);
    expect(segDist({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(2);
    expect(segDist({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(Math.SQRT2 * 2);
  });
});

describe("keeper reach", () => {
  it("standing tall covers the middle but not the corners", () => {
    const k = keeperBody(null, 0);
    expect(resolve({ x: 0, y: 0.3 }, k).outcome).toBe("save");
    expect(resolve({ x: 0.45, y: 1.6 }, k).outcome).toBe("save");
    expect(resolve({ x: 1.6, y: 1 }, k).outcome).toBe("goal");
    expect(resolve({ x: -3, y: 2.1 }, k).outcome).toBe("goal");
  });

  it("a full dive reaches about 3.3 m but never the top corner", () => {
    const right = keeperBody({ dx: 1, dy: 0 }, DIVE_TIME);
    expect(resolve({ x: 2.6, y: 1.1 }, right).outcome).toBe("save");
    expect(resolve({ x: 3.25, y: 1.2 }, right).outcome).toBe("save");
    expect(resolve({ x: 3.5, y: 2.25 }, right).outcome).toBe("goal");
    expect(resolve({ x: -2.6, y: 1.1 }, right).outcome).toBe("goal"); // wrong way
  });

  it("dive height matters: a low dive gets the low corner, a mid dive does not", () => {
    const low = keeperBody({ dx: -1, dy: -1 }, DIVE_TIME);
    const mid = keeperBody({ dx: -1, dy: 0 }, DIVE_TIME);
    expect(resolve({ x: -3.1, y: 0.2 }, low).outcome).toBe("save");
    expect(resolve({ x: -3.1, y: 0.2 }, mid).outcome).toBe("goal");
  });

  it("a jump covers high and central", () => {
    const jump = keeperBody({ dx: 0, dy: 1 }, DIVE_TIME);
    expect(resolve({ x: 0.4, y: 2.3 }, jump).outcome).toBe("save");
    expect(resolve({ x: 0.4, y: 2.3 }, keeperBody(null, 0)).outcome).toBe("goal");
  });

  it("reaction: a late dive only gets part of the way", () => {
    const shot = { x: 2.6, y: 1.1 };
    expect(resolve(shot, keeperBody({ dx: 1, dy: 0 }, DIVE_TIME * 0.2)).outcome).toBe("goal");
    expect(resolve(shot, keeperBody({ dx: 1, dy: 0 }, DIVE_TIME * 0.9)).outcome).toBe("save");
    const far = keeperBody({ dx: 1, dy: 0 }, DIVE_TIME);
    const later = keeperBody({ dx: 1, dy: 0 }, DIVE_TIME * 3);
    expect(later).toEqual(far); // stays at full stretch
  });
});

describe("ball flight", () => {
  it("aims map into the goal plane, slightly beyond the frame at the extremes", () => {
    expect(aimToGoal(0, 0).y).toBe(BALL_R);
    expect(aimToGoal(1, 1).x).toBeGreaterThan(HALF_W);
    expect(aimToGoal(-1, 1).y).toBeGreaterThan(GOAL_H);
    expect(aimToGoal(5, 5)).toEqual(aimToGoal(1.15, 1.15));
  });

  it("harder shots are faster", () => {
    expect(flightTime(1)).toBeCloseTo(0.5);
    expect(flightTime(0.4)).toBeGreaterThan(flightTime(0.9));
    expect(flightTime(1.3)).toBeCloseTo(0.5);
  });

  it("a clean shot ends where it was aimed; curve moves it and bends the path", () => {
    const s = makeShot({ x: 2, y: 1 }, 0.8, 0, still);
    expect(s.target.x).toBeCloseTo(2, 5);
    expect(s.target.y).toBeCloseTo(1, 5);
    const start = ballAt(s, 0);
    expect(start).toMatchObject({ x: 0, dist: SPOT });
    expect(start.y).toBeCloseTo(BALL_R);
    expect(ballAt(s, 1)).toMatchObject({ x: s.target.x, dist: 0 });
    const curled = makeShot({ x: 2, y: 1 }, 0.8, 1, still);
    expect(curled.target.x).toBeCloseTo(2.9, 5);
    expect(ballAt(curled, 0.5).x).toBeLessThan(curled.target.x / 2); // swings out first, bends in late
  });

  it("overhitting lifts the ball over the bar", () => {
    const s = makeShot({ x: 0, y: 1.8 }, 1.3, 0, still);
    expect(resolve(s.target, AWAY).outcome).toBe("over");
    expect(resolve(makeShot({ x: 0, y: 1.8 }, 0.95, 0, still).target, AWAY).outcome).toBe("goal");
  });

  it("accuracy drops above 85% power (seeded)", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const spread = (p: number) => {
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += Math.abs(makeShot({ x: 0, y: 1 }, p, 0, rand).target.x);
      return sum / 400;
    };
    expect(spread(1)).toBeGreaterThan(spread(0.7) * 1.8);
  });
});
