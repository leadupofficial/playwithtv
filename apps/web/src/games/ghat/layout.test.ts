import { describe, expect, it } from "vitest";
import { splitLayout, toPixels } from "./layout";

describe("split-screen layout", () => {
  it("gives every player a view and fills spare cells with the director camera", () => {
    expect(splitLayout(1)).toMatchObject({ cols: 1, rows: 1, director: [] });
    expect(splitLayout(2).player.map((r) => r.y)).toEqual([0, 0.5]);
    expect(splitLayout(3).director).toHaveLength(1);
    expect(splitLayout(5)).toMatchObject({ cols: 3, rows: 2 });
    expect(splitLayout(5).director).toHaveLength(1);
    expect(splitLayout(8)).toMatchObject({ cols: 4, rows: 2, director: [] });
    for (let n = 1; n <= 8; n++) {
      const l = splitLayout(n);
      expect(l.player).toHaveLength(n);
      const area = [...l.player, ...l.director].reduce((a, r) => a + r.w * r.h, 0);
      expect(area).toBeCloseTo(1, 6);
    }
  });

  it("converts to WebGL pixels (bottom-left origin) with a gap between views", () => {
    const [top, bottom] = splitLayout(2).player;
    expect(toPixels(top!, 1280, 720)).toEqual({ x: 0, y: 362, w: 1280, h: 358 });
    expect(toPixels(bottom!, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 360 });
  });
});
