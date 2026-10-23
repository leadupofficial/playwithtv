import { describe, expect, it } from "vitest";
import { InputMerger } from "./rtc";

describe("input merging (direct link + hub relay)", () => {
  it("uses each frame once, whichever path delivers it first, and never goes back in time", () => {
    const m = new InputMerger();
    expect(m.accept("a", 1)).toBe(true);   // via direct link
    expect(m.accept("a", 1)).toBe(false);  // same frame via the hub
    expect(m.accept("a", 3)).toBe(true);
    expect(m.accept("a", 2)).toBe(false);  // late frame: the newer state already arrived
    expect(m.accept("b", 0)).toBe(true);   // players are independent
  });

  it("starts over when a phone disconnects (a reloaded phone counts from 0)", () => {
    const m = new InputMerger();
    m.accept("a", 500);
    m.reset("a");
    expect(m.accept("a", 0)).toBe(true);
  });
});
