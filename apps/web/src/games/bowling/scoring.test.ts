import { describe, expect, it } from "vitest";
import { callout, framesDone, isComplete, nextBall, scoreFrames, totalScore } from "./scoring";

const rep = (n: number, ...r: number[]) => Array.from({ length: n }, () => r).flat();

describe("ten-pin scoring", () => {
  it("a perfect game is 300 (twelve strikes)", () => {
    const rolls = rep(12, 10);
    expect(totalScore(rolls)).toBe(300);
    expect(isComplete(rolls)).toBe(true);
    const f = scoreFrames(rolls);
    expect(f).toHaveLength(10);
    expect(f[0]!.total).toBe(30);
    expect(f[9]!.marks).toEqual(["X", "X", "X"]);
  });

  it("all gutter balls score 0 and take 20 balls", () => {
    expect(totalScore(rep(20, 0))).toBe(0);
    expect(isComplete(rep(19, 0))).toBe(false);
    expect(isComplete(rep(20, 0))).toBe(true);
    expect(scoreFrames(rep(20, 0))[0]!.marks).toEqual(["-", "-"]);
  });

  it("all 5-spares with a 5 bonus ball is 150", () => {
    const rolls = rep(21, 5);
    expect(totalScore(rolls)).toBe(150);
    expect(scoreFrames(rolls)[0]!.marks).toEqual(["5", "/"]);
    expect(scoreFrames(rolls)[9]!.marks).toEqual(["5", "/", "5"]);
  });

  it("a strike scores 10 plus the next two balls; a spare 10 plus the next ball", () => {
    // X | 3 4 → 17, 24
    const a = scoreFrames([10, 3, 4]);
    expect(a.map((f) => f.total)).toEqual([17, 24]);
    // 7 / | 4 2 → 14, 20
    const b = scoreFrames([7, 3, 4, 2]);
    expect(b.map((f) => f.total)).toEqual([14, 20]);
    // X X | 4 → strike-strike-4 = 24 for frame 1; frame 2 still pending
    const c = scoreFrames([10, 10, 4]);
    expect(c.map((f) => f.total)).toEqual([24, null, null]);
  });

  it("totals stay pending until bonus balls are thrown", () => {
    expect(scoreFrames([10]).map((f) => f.total)).toEqual([null]);
    expect(scoreFrames([10, 5]).map((f) => f.total)).toEqual([null, null]);
    expect(scoreFrames([6, 4]).map((f) => f.total)).toEqual([null]);
    expect(scoreFrames([6, 3]).map((f) => f.total)).toEqual([9]);
    expect(totalScore([10, 5])).toBe(0);
  });

  it("10th frame: an open frame ends after two balls", () => {
    const rolls = [...rep(18, 0), 3, 4];
    expect(isComplete(rolls)).toBe(true);
    expect(totalScore(rolls)).toBe(7);
    expect(nextBall([...rep(18, 0), 3])).toEqual({ frame: 9, ball: 1, freshRack: false, standing: 7 });
  });

  it("10th frame: a spare earns one bonus ball on a fresh rack", () => {
    const base = [...rep(18, 0), 6, 4];
    expect(nextBall(base)).toEqual({ frame: 9, ball: 2, freshRack: true, standing: 10 });
    expect(totalScore([...base, 10])).toBe(20);
    expect(scoreFrames([...base, 10])[9]!.marks).toEqual(["6", "/", "X"]);
  });

  it("10th frame: a strike earns two bonus balls; racks reset only after strikes", () => {
    const base = [...rep(18, 0), 10];
    expect(nextBall(base)).toEqual({ frame: 9, ball: 1, freshRack: true, standing: 10 });
    expect(nextBall([...base, 7])).toEqual({ frame: 9, ball: 2, freshRack: false, standing: 3 });
    expect(nextBall([...base, 10])).toEqual({ frame: 9, ball: 2, freshRack: true, standing: 10 });
    expect(totalScore([...base, 7, 3])).toBe(20);
    expect(scoreFrames([...base, 7, 3])[9]!.marks).toEqual(["X", "7", "/"]);
    expect(scoreFrames([...base, 10, 4])[9]!.marks).toEqual(["X", "X", "4"]);
    expect(isComplete([...base, 7, 3])).toBe(true);
  });

  it("strikes in frame 9 take their bonus from the 10th frame", () => {
    const rolls = [...rep(16, 0), 10, 10, 10, 10];
    const f = scoreFrames(rolls);
    expect(f[8]!.total).toBe(30);
    expect(f[9]!.total).toBe(60);
  });

  it("a typical game adds up (known sheet = 133)", () => {
    // 1 4 | 4 5 | 6 / | 5 / | X | 0 1 | 7 / | 6 / | X | 2 / 6
    const rolls = [1, 4, 4, 5, 6, 4, 5, 5, 10, 0, 1, 7, 3, 6, 4, 10, 2, 8, 6];
    expect(scoreFrames(rolls).map((f) => f.total)).toEqual([5, 14, 29, 49, 60, 61, 77, 97, 117, 133]);
    expect(isComplete(rolls)).toBe(true);
  });

  it("next ball walks through frames", () => {
    expect(nextBall([])).toEqual({ frame: 0, ball: 0, freshRack: true, standing: 10 });
    expect(nextBall([10])).toEqual({ frame: 1, ball: 0, freshRack: true, standing: 10 });
    expect(nextBall([2])).toEqual({ frame: 0, ball: 1, freshRack: false, standing: 8 });
    expect(nextBall([2, 3])).toEqual({ frame: 1, ball: 0, freshRack: true, standing: 10 });
    expect(framesDone([2, 3, 10])).toBe(2);
  });

  it("quick 2-frame games use the final-frame rules on frame 2", () => {
    expect(nextBall([10], 2)).toEqual({ frame: 1, ball: 0, freshRack: true, standing: 10 });
    expect(nextBall([10, 10], 2)).toEqual({ frame: 1, ball: 1, freshRack: true, standing: 10 });
    expect(totalScore([10, 10, 10, 10], 2)).toBe(60);
    expect(isComplete([3, 4, 5, 1], 2)).toBe(true);
    expect(totalScore([3, 4, 5, 1], 2)).toBe(13);
    expect(isComplete([3, 4, 5, 5], 2)).toBe(false);
    expect(totalScore([3, 4, 5, 5, 2], 2)).toBe(19);
  });

  it("callouts", () => {
    expect(callout(10, 10, true)).toBe("STRIKE!");
    expect(callout(3, 3, false)).toBe("SPARE!");
    expect(callout(0, 10, true)).toBe("Gutter ball");
    expect(callout(1, 4, false)).toBe("1 pin");
    expect(callout(7, 10, true)).toBe("7 pins");
  });
});
