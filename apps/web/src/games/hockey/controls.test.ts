import { describe, expect, it } from "vitest";
import { commandFor, newPadMemory, toHalf } from "./controls";
import { bounds, home } from "./engine";

describe("air hockey controls", () => {
  it("the touchpad maps onto the player's own half, the same way round as the TV", () => {
    expect(toHalf(0, -1, 0).x).toBeCloseTo(bounds(0).x0);       // left player: pad left edge = their goal end
    expect(toHalf(0, 1, 0).x).toBeCloseTo(bounds(0).x1);        // pad right edge = the centre line
    expect(toHalf(1, -1, 0).x).toBeCloseTo(bounds(1).x0);       // right player: pad left edge = the centre line
    expect(toHalf(1, 1, 1)).toEqual({ x: bounds(1).x1, y: bounds(1).y1 });
  });

  it("lifting the finger keeps the striker where it was", () => {
    const mem = newPadMemory(0);
    const a = commandFor(0, "touchpad", { ok: true, x: 0.5, y: -0.5 }, mem, false);
    const b = commandFor(0, "touchpad", { ok: true, x: 0, y: 0 }, mem, false);
    expect(b).toMatchObject({ kind: "target", x: a.x, y: a.y });
    expect(a.y).toBeLessThan(0);
  });

  it("buttons drive with velocity and pass SMASH through", () => {
    const c = commandFor(1, "buttons", { ok: true, x: -1, y: 0.5 }, newPadMemory(1), true);
    expect(c).toMatchObject({ kind: "velocity", x: -1, y: 0.5, smash: true });
    expect(commandFor(1, "buttons", { ok: false, x: -1, y: 0.5 }, newPadMemory(1), false)).toMatchObject({ x: 0, y: 0 });
  });

  it("level tilt holds the striker in the middle of its half", () => {
    const mem = newPadMemory(0);
    const c = commandFor(0, "motion", { ok: true, x: 0, y: 0 }, mem, false);
    expect(c.x).toBeCloseTo((bounds(0).x0 + bounds(0).x1) / 2);
    const lost = commandFor(0, "motion", { ok: false, x: 1, y: 1 }, mem, false);
    expect(lost.x).toBeCloseTo(c.x);
    expect(newPadMemory(1)).toMatchObject(home(1));
  });
});
