import { describe, expect, it } from "vitest";
import type { ControlSpec } from "@playwithtv/protocol";
import { resolver } from "./gestureMap";

const spec = (actions: ControlSpec["actions"]) => ({ title: "t", modes: ["motion"], actions }) as unknown as ControlSpec;

describe("gesture map", () => {
  it("a game with only push takes a pull as the same action (real pushes often read as pulls)", () => {
    const m = resolver(spec([{ id: "bowl", label: "BOWL", gestures: ["push"] }, { id: "pace", label: "PACE", gestures: ["twist-right"] }]));
    expect(m.gesture("push", 1)?.id).toBe("bowl");
    expect(m.gesture("pull", 1)?.id).toBe("bowl");
    expect(m.gesture("flick-down", 1)).toBeNull();
  });

  it("a game with only pull takes a push too", () => {
    expect(resolver(spec([{ id: "item", label: "ITEM", gestures: ["pull"] }])).gesture("push", 1)?.id).toBe("item");
  });

  it("a game mapping both keeps them apart", () => {
    const m = resolver(spec([{ id: "strike", label: "S", gestures: ["push"] }, { id: "block", label: "B", gestures: ["pull"] }]));
    expect(m.gesture("push", 1)?.id).toBe("strike");
    expect(m.gesture("pull", 1)?.id).toBe("block");
  });

  it("a strong pull still means the power move", () => {
    const m = resolver(spec([{ id: "strike", label: "S", gestures: ["push"] }, { id: "heavy", label: "H", strongOf: "strike" }]));
    expect(m.gesture("pull", 9)?.id).toBe("heavy");
  });
});
