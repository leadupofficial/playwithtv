import { describe, expect, it } from "vitest";
import { FrameGovernor, LEVELS } from "./governor";

/** Feeds `seconds` of frames at `fps` and returns every level change. */
function run(g: FrameGovernor, fps: number, seconds: number) {
  const changes: number[] = [];
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const c = g.sample(1000 / fps);
    if (c !== null) changes.push(c);
  }
  return changes;
}
/** No warm-up and one slow window per step: the bare mechanics. */
const quick = () => new FrameGovernor(LEVELS.length, { warmupWindows: 0, downWindows: 1 });

describe("FrameGovernor", () => {
  it("stays at full quality while the game holds 60 fps", () => {
    const g = new FrameGovernor(LEVELS.length);
    expect(run(g, 60, 20)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it("ignores the warm-up seconds and single hitches (defaults: 3 warm-up windows, 2 slow windows per step)", () => {
    const g = new FrameGovernor(LEVELS.length);
    run(g, 20, 3);                 // shader compilation, uploads: ignored
    expect(g.level).toBe(0);
    run(g, 60, 2);
    run(g, 30, 1);                 // one slow second
    run(g, 60, 2);
    expect(g.level).toBe(0);
    expect(run(g, 30, 2.1)).toEqual([1]); // two slow seconds in a row: one step
  });

  it("steps down while the frame rate sags, never below the floor", () => {
    const g = quick();
    expect(run(g, 20, 30)).toEqual([1, 2, 3, 4, 5]);
    expect(g.level).toBe(LEVELS.length - 1);
    expect(run(g, 20, 10)).toEqual([]);
  });

  it("stops stepping down once the game is smooth again", () => {
    const g = quick();
    run(g, 40, 2);                 // one step down (window 1), then a settling window
    expect(g.level).toBe(1);
    run(g, 55, 4);                 // between low and high: hold
    expect(g.level).toBe(1);
  });

  it("steps back up after sustained headroom", () => {
    const g = quick();
    run(g, 30, 5);
    const lowest = g.level;
    expect(lowest).toBeGreaterThan(1);
    expect(run(g, 60, 7)).toEqual([lowest - 1]);
  });

  it("does not oscillate: a step up that fails is undone at once and blocked for a while", () => {
    const g = quick();
    run(g, 30, 2);
    expect(g.level).toBe(1);
    run(g, 60, 6);                 // headroom at level 1 → tries level 0
    expect(g.level).toBe(0);
    run(g, 40, 2);                 // level 0 is too slow again → back to 1, level 0 blocked
    expect(g.level).toBe(1);
    expect(run(g, 60, 7)).toEqual([]); // still blocked after the normal 5 good windows
  });

  it("ignores hidden-tab gaps and junk", () => {
    const g = quick();
    for (let i = 0; i < 20; i++) expect(g.sample(2000)).toBeNull();
    expect(g.sample(0)).toBeNull();
    expect(g.sample(Number.NaN)).toBeNull();
    expect(g.level).toBe(0);
  });

  it("levels shed AO first, then resolution (floor 0.67), then bloom", () => {
    expect(LEVELS[0]).toEqual({ scale: 1, ao: true, bloom: true });
    expect(LEVELS[1]!.ao).toBe(false);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i]!.scale).toBeLessThanOrEqual(LEVELS[i - 1]!.scale);
    expect(Math.min(...LEVELS.map((l) => l.scale))).toBeGreaterThanOrEqual(0.67);
    expect(LEVELS.at(-1)!.bloom).toBe(false);
  });
});
