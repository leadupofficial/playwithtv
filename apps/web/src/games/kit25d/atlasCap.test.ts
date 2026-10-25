import { describe, expect, it } from "vitest";
import { atlasScale } from "./spriteBatch";

describe("atlasScale (lite-tier memory cap)", () => {
  it("leaves atlases that fit alone, and does nothing without a cap", () => {
    expect(atlasScale(1200, 1150, 1536)).toBe(1);
    expect(atlasScale(3840, 3690, 0)).toBe(1);
  });
  it("shrinks the long side to the cap", () => {
    expect(atlasScale(3840, 3690, 1536)).toBeCloseTo(0.4);
    expect(atlasScale(1600, 1904, 1536) * 1904).toBeCloseTo(1536);
  });
  it("cuts a Kalari sheet from 57 MB to under 10 MB of RGBA", () => {
    const k = atlasScale(3840, 3690, 1536);
    const bytes = Math.round(3840 * k) * Math.round(3690 * k) * 4;
    expect(3840 * 3690 * 4 / 1e6).toBeGreaterThan(56);
    expect(bytes / 1e6).toBeLessThan(10);
  });
});
