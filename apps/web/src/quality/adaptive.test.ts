import { describe, expect, it } from "vitest";
import { AdaptiveQuality, type AdaptiveStep } from "./adaptive";

/** Runs `seconds` of frames at a fixed fps, returning the steps taken. */
function run(g: AdaptiveQuality, fps: number, seconds: number): AdaptiveStep[] {
  const out: AdaptiveStep[] = [];
  for (let t = 0; t < seconds; t += 1 / fps) {
    const s = g.frame(1 / fps);
    if (s) out.push(s);
  }
  return out;
}

describe("adaptive quality guard", () => {
  it("leaves a fast game alone", () => {
    const g = new AdaptiveQuality({ game: "t", tier: "ultra", persist: false });
    expect(run(g, 60, 30)).toEqual([]);
    expect(g.state).toMatchObject({ tier: "ultra", scale: 1, dropped: [] });
    expect(g.state.fps).toBe(60);
  });

  it("steps down in order: resolution, then features, then the tier", () => {
    const g = new AdaptiveQuality({ game: "t", tier: "ultra", persist: false });
    const steps = run(g, 20, 200);
    expect(steps.slice(0, 7)).toEqual([
      { kind: "scale", scale: 0.85 }, { kind: "scale", scale: 0.72 }, { kind: "scale", scale: 0.6 },
      { kind: "drop", feature: "ao" }, { kind: "drop", feature: "shadows-small" }, { kind: "drop", feature: "shadows" }, { kind: "drop", feature: "bloom" },
    ]);
    expect(steps[7]).toEqual({ kind: "tier", tier: "high" });
    // high has no AO to drop; then lite, where only the resolution can still go down
    expect(steps).toContainEqual({ kind: "tier", tier: "lite" });
    expect(g.state).toMatchObject({ tier: "lite", scale: 0.6 });
    expect(g.next()).toBeNull();
  });

  it("waits a warm-up and a full window between steps, and never steps back up", () => {
    const g = new AdaptiveQuality({ game: "t", tier: "high", persist: false });
    expect(run(g, 30, 5)).toHaveLength(0); // 3 s warm-up + 2.5 s window not yet complete
    expect(run(g, 30, 1)).toHaveLength(1);
    expect(run(g, 30, 4)).toHaveLength(0);
    expect(run(g, 120, 30)).toEqual([]); // fast again: nothing goes back up
    expect(g.state.scale).toBe(0.85);
  });

  it("respects the floor and ignores hitches", () => {
    const g = new AdaptiveQuality({ game: "t", tier: "high", floor: "high", features: ["bloom"], persist: false });
    const steps = run(g, 10, 120);
    expect(steps.map((s) => s.kind)).toEqual(["scale", "scale", "scale", "drop"]);
    expect(g.frame(2)).toBeNull();
  });
});
