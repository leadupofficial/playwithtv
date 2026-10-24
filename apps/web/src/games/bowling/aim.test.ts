import { describe, expect, it } from "vitest";
import { ANGLE_MAX, METER_PERIOD, POS_MAX, SPEED_MAX, SPEED_MIN, aimAction, autoShot, meterAt, newAim, updateAim, type AimInput } from "./aim";

const DT = 1 / 60;
const run = (a: ReturnType<typeof newAim>, inp: Partial<AimInput>, seconds: number) => {
  let shot = null;
  for (let i = 0; i < Math.round(seconds / DT); i++) shot = updateAim(a, { mode: "buttons", ok: true, x: 0, y: 0, rollHeld: false, ...inp }, DT) ?? shot;
  return shot;
};

describe("bowling aim: buttons", () => {
  it("◀ ▶ walk the bowler, within the lane", () => {
    const a = newAim();
    run(a, { x: 1 }, 0.5);
    expect(a.pos).toBeGreaterThan(0.05);
    run(a, { x: 1 }, 5);
    expect(a.pos).toBe(POS_MAX);
    run(a, { x: -1 }, 10);
    expect(a.pos).toBe(-POS_MAX);
  });

  it("holding ROLL swings the power meter; letting go rolls at that power", () => {
    const a = newAim(0.1);
    expect(run(a, { rollHeld: true }, METER_PERIOD / 2)).toBeNull();
    expect(a.charging).toBe(true);
    expect(a.meter).toBeGreaterThan(0.95);
    const shot = run(a, { rollHeld: false }, DT)!;
    expect(shot.x).toBeCloseTo(0.1);
    expect(shot.speed).toBeGreaterThan(SPEED_MAX - 0.2);
    // a quick tap is a slow ball
    const b = newAim();
    run(b, { rollHeld: true }, 0.1);
    expect(run(b, { rollHeld: false }, DT)!.speed).toBeLessThan(SPEED_MIN + 0.8);
  });

  it("◀ ▶ while charging steer the aim instead of walking", () => {
    const a = newAim(0);
    run(a, { rollHeld: true, x: 1 }, 0.6);
    expect(a.pos).toBe(0);
    expect(a.angle).toBeGreaterThan(0.01);
    const shot = run(a, { rollHeld: false, x: 0 }, DT)!;
    expect(shot.angle).toBeGreaterThan(0.01);
    expect(shot.angle).toBeLessThanOrEqual(ANGLE_MAX);
  });

  it("SPIN cycles straight, hook left, hook right", () => {
    const a = newAim();
    aimAction(a, "buttons", "spin");
    expect(a.spin).toBe(-1);
    aimAction(a, "buttons", "spin");
    expect(a.spin).toBe(1);
    aimAction(a, "buttons", "spin");
    expect(a.spin).toBe(0);
    expect(aimAction(a, "buttons", "roll")).toBeNull(); // buttons roll on release, not on the tap counter
  });

  it("the power meter swings 0 → 1 → 0", () => {
    expect(meterAt(0)).toBe(0);
    expect(meterAt(METER_PERIOD / 2)).toBeCloseTo(1);
    expect(meterAt(METER_PERIOD)).toBeCloseTo(0);
  });
});

describe("bowling aim: motion", () => {
  it("turning the phone swings the arrow; a push rolls with the steady aim from just before", () => {
    const a = newAim();
    run(a, { mode: "motion", x: 0.8 }, 1);
    expect(a.angle).toBeGreaterThan(ANGLE_MAX * 0.9);
    run(a, { mode: "motion", x: -0.5 }, 0.05);                  // the push jolts the phone the other way
    const shot = aimAction(a, "motion", "roll")!;
    expect(shot.angle).toBeGreaterThan(ANGLE_MAX * 0.8);
    expect(aimAction(newAim(), "motion", "power")!.speed).toBeGreaterThan(shot.speed);
  });

  it("flicks step, twists add hook", () => {
    const a = newAim();
    aimAction(a, "motion", "stepR");
    aimAction(a, "motion", "stepR");
    expect(a.pos).toBeCloseTo(0.14);
    aimAction(a, "motion", "hookL");
    expect(a.spin).toBe(-1);
    aimAction(a, "motion", "hookL");
    expect(a.spin).toBe(-1);
    aimAction(a, "motion", "hookR");
    expect(a.spin).toBe(0);
  });
});

describe("bowling aim: touchpad", () => {
  it("dragging walks; lifting the finger keeps the spot", () => {
    const a = newAim();
    run(a, { mode: "touchpad", x: -0.2, y: -0.5 }, 0.1);
    run(a, { mode: "touchpad", x: 0.6, y: -0.5 }, 0.2);
    expect(a.pos).toBeCloseTo(0.8 * POS_MAX);
    run(a, { mode: "touchpad", x: 0, y: 0 }, 1);
    expect(a.pos).toBeCloseTo(0.8 * POS_MAX);
  });

  it("a swipe up rolls from where the stroke began; its slant aims and its length sets the speed", () => {
    const a = newAim(0.1);
    run(a, { mode: "touchpad", x: 0, y: -0.8 }, 0.05);
    run(a, { mode: "touchpad", x: 0.25, y: 0.6 }, 0.05);
    const shot = aimAction(a, "touchpad", "roll")!;
    expect(shot.x).toBeCloseTo(0.1);
    expect(shot.angle).toBeGreaterThan(0);
    expect(shot.speed).toBeGreaterThan(SPEED_MIN + 1);
    const b = newAim();
    run(b, { mode: "touchpad", x: 0, y: -0.3 }, 0.05);
    run(b, { mode: "touchpad", x: 0, y: 0.3 }, 0.05);
    expect(aimAction(b, "touchpad", "roll")!.speed).toBeLessThan(shot.speed);
  });

  it("a sideways swipe adds hook without moving the bowler", () => {
    const a = newAim(0);
    run(a, { mode: "touchpad", x: 0, y: 0.1 }, 0.05);
    run(a, { mode: "touchpad", x: -0.7, y: 0.1 }, 0.05);
    run(a, { mode: "touchpad", x: 0, y: 0 }, 0.05);
    aimAction(a, "touchpad", "hookL");
    expect(a.pos).toBe(0);
    expect(a.spin).toBe(-1);
  });

  it("the shot clock's auto shot uses the current aim", () => {
    const a = newAim(-0.2, 1);
    expect(autoShot(a)).toMatchObject({ x: -0.2, spin: 1 });
  });
});
