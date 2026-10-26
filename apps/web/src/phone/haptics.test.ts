import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_MAX_MS, buzz, capped, hapticsOn, setHaptics } from "./haptics";

describe("haptics", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("caps buzzes in motion mode only, pauses in a pattern untouched", () => {
    expect(capped(400, false)).toBe(400);
    expect(capped(400, true)).toBe(MOTION_MAX_MS);
    expect(capped(25, true)).toBe(25);
    expect(capped([300, 500, 300], true)).toEqual([MOTION_MAX_MS, 500, MOTION_MAX_MS]);
  });

  it("is on by default, and off stops every buzz", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    expect(hapticsOn()).toBe(true);
    buzz(40);
    expect(vibrate).toHaveBeenLastCalledWith(40);
    setHaptics(false);
    vibrate.mockClear();
    buzz(40);
    buzz(400, true);
    expect(vibrate).not.toHaveBeenCalled();
    expect(hapticsOn()).toBe(false);
    setHaptics(true);
    buzz(400, true);
    expect(vibrate).toHaveBeenLastCalledWith(MOTION_MAX_MS);
  });
});
