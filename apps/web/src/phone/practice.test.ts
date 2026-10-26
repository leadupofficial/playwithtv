import { describe, expect, it } from "vitest";
import type { ControlSpec } from "@playwithtv/protocol";
import { PRACTICE_GAIN, gainFrom, needsPractice, practiceAction, practised } from "./practice";

const spec = (actions: ControlSpec["actions"]) => ({ title: "t", modes: ["motion"], actions }) as unknown as ControlSpec;

describe("practice your move", () => {
  it("practises the first action fired by a deliberate move, not a shake", () => {
    const s = spec([{ id: "cheer", label: "C", gestures: ["shake"] }, { id: "bowl", label: "B", gestures: ["push"] }]);
    expect(practiceAction(s)?.id).toBe("bowl");
    expect(practiceAction(spec([{ id: "cheer", label: "C", gestures: ["shake"] }]))).toBeNull();
    expect(practiceAction(spec([{ id: "a", label: "A" }]))).toBeNull();
  });

  it("a gentle player gets a lower threshold, a strong one a higher one, so their usual move clears it", () => {
    // gentle: pushes of ~9 m/s² read about 2 at the practice gain (threshold 11 / 2.5 = 4.4)
    const gentle = gainFrom([1.9, 2, 2.1])!;
    expect(gentle).toBeGreaterThan(1);
    expect((2 * gentle) / PRACTICE_GAIN).toBeCloseTo(1 / 0.6, 1);
    const strong = gainFrom([5, 6, 7])!;
    expect(strong).toBeLessThan(1);
    expect(gainFrom([])).toBeNull();
  });

  it("uses the median, so one wild move does not set it", () => {
    expect(gainFrom([1.4, 1.5, 9])).toBe(gainFrom([1.4, 1.5, 1.6]));
  });

  it("stays within the slider's range", () => {
    expect(gainFrom([0.2])).toBe(2.5);
    expect(gainFrom([40])).toBe(0.5);
  });

  it("asks once per move per visit", () => {
    const s = spec([{ id: "bowl", label: "B", gestures: ["push"] }]);
    const a = practiceAction(s)!;
    expect(needsPractice(s, a)).toBe(true);
    practised(s, a);
    expect(needsPractice(s, a)).toBe(false);
  });
});
