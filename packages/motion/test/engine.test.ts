import { describe, expect, it } from "vitest";
import { ControlReader, HoldTimer, MODE_DIVISOR, MotionEngine, TraceBuilder, frameAxes, pose, replay, toScreen, v, zoneOf } from "../src/index.js";

const UP = pose(0, 0);
const kinds = (t: ReturnType<typeof replay>) => t.gestures.map((g) => g.kind);

describe("tilt", () => {
  it("reads steering and tipping relative to how the phone was held at calibration", () => {
    const r = replay(new TraceBuilder().hold(pose(0, 35), 300).hold(pose(20, 35), 800).build("held tilted back, then steer right"));
    expect(r.last.rollDeg).toBeGreaterThan(14);
    expect(r.last.roll).toBeGreaterThan(0.4);
    expect(Math.abs(r.last.pitch)).toBeLessThan(0.15);
  });

  it("works the same for a phone lying flat (maze style)", () => {
    const right = replay(new TraceBuilder().hold(pose(0, 0, "flat"), 300).hold(pose(15, 0, "flat"), 800).build("flat, right side down"));
    expect(right.last.roll).toBeGreaterThan(0.3);
    const fwd = replay(new TraceBuilder().hold(pose(0, 0, "flat"), 300).hold(pose(0, 15, "flat"), 800).build("flat, top edge down"));
    expect(fwd.last.pitch).toBeGreaterThan(0.3);
    expect(Math.abs(fwd.last.roll)).toBeLessThan(0.1);
  });

  it("ignores small tilts inside the dead zone and clamps large ones", () => {
    const still = replay(new TraceBuilder().hold(UP, 300).hold(pose(2, -2), 800).build("resting hand"));
    expect(still.last.roll).toBe(0);
    expect(still.last.pitch).toBe(0);
    const big = replay(new TraceBuilder().hold(UP, 300).hold(pose(-70, 0), 800).build("hard left"));
    expect(big.last.roll).toBe(-1);
  });

  it("sensitivity scales the output", () => {
    const t = new TraceBuilder().hold(UP, 300).hold(pose(12, 0), 800).build("gentle right");
    expect(replay(t, { sensitivity: 2 }).last.roll).toBeCloseTo(replay(t, { sensitivity: 1 }).last.roll * 2, 1);
  });

  it("recalibrates to a new neutral pose", () => {
    const e = new MotionEngine();
    let t = 0;
    const feed = (g: ReturnType<typeof pose>, ms: number) => { for (let x = 0; x < ms; x += 16) e.push({ t: (t += 16), gravity: g, linear: v(0, 0, 0), rotation: v(0, 0, 0) }); };
    feed(UP, 300);
    feed(pose(25, 0), 800);
    expect(e.frame().roll).toBeGreaterThan(0.5);
    e.calibrate();
    feed(pose(25, 0), 300);
    expect(e.frame().roll).toBe(0);
  });

  it("reports stillness, sample rate and stale sensors", () => {
    const e = new MotionEngine();
    for (let t = 16; t < 1000; t += 16) e.push({ t, gravity: UP, linear: v(0, 0, 0), rotation: null });
    const f = e.frame(1000);
    expect(f.still).toBe(true);
    expect(f.health.rateHz).toBeGreaterThan(50);
    expect(f.health.hasRotation).toBe(false);
    expect(e.frame(1800).health.stale).toBe(true);
  });
});

describe("gestures", () => {
  it.each([
    ["push", v(0, 0, -1)],     // towards the TV (out of the back of the screen)
    ["pull", v(0, 0, 1)],
    ["flick-up", v(0, 1, 0)],
    ["flick-down", v(0, -1, 0)],
    ["flick-left", v(-1, 0, 0)],
    ["flick-right", v(1, 0, 0)],
  ])("recognises %s exactly once per movement", (kind, dir) => {
    const r = replay(new TraceBuilder().hold(UP, 300).burst(UP, dir, 18).hold(UP, 400).build(kind));
    expect(kinds(r)).toEqual([kind]);
  });

  it("keeps directions relative to the calibrated pose (flat phone: push = towards the top edge)", () => {
    const flat = pose(0, 0, "flat");
    const r = replay(new TraceBuilder().hold(flat, 300).burst(flat, v(0, 1, 0), 18).hold(flat, 400).build("flat push"));
    expect(kinds(r)).toEqual(["push"]);
  });

  it("sensitivity sets how hard a move must be, for pushes, twists and swings", () => {
    // measured on a real phone: a player's pushes peaked at 5-11 m/s², swings at 6-8 and twists at 190-250 deg/s
    const push = new TraceBuilder().hold(UP, 300).burst(UP, v(0, 0, -1), 9).hold(UP, 400).build("a modest push");
    expect(kinds(replay(push, { sensitivity: 1 }))).toEqual([]);
    expect(kinds(replay(push, { sensitivity: 1.5 }))).toEqual(["push"]);
    const hard = new TraceBuilder().hold(UP, 300).burst(UP, v(0, 0, -1), 18).hold(UP, 400).build("a hard push");
    expect(kinds(replay(hard, { sensitivity: 0.5 }))).toEqual([]);
    const twist = new TraceBuilder().hold(UP, 300).spin(UP, 210).hold(UP, 300).build("a real player's twist");
    expect(kinds(replay(twist))).toEqual([]);
    expect(kinds(replay(twist, { sensitivity: 1.3 }))).toEqual(["twist-left"]);
    const swing = new TraceBuilder().hold(UP, 300).burst(UP, v(1, 0, 0), 9).hold(UP, 500).build("a gentle swing");
    expect(kinds(replay(swing, { swing: true, gestureThreshold: 99 }))).not.toContain("swing");
    expect(kinds(replay(swing, { swing: true, gestureThreshold: 99, sensitivity: 1.6 }))).toContain("swing");
  });

  it("works without the browser's linear acceleration (gravity filtered out instead)", () => {
    const r = replay(new TraceBuilder(60, false).hold(UP, 300).burst(UP, v(0, 0, -1), 20).hold(UP, 400).build("no linear"));
    expect(kinds(r)).toContain("push");
  });

  it("does not fire on gentle movement, noise or a single knock", () => {
    const r = replay(new TraceBuilder()
      .hold(UP, 300, 0.4)
      .burst(UP, v(1, 0, 0), 6)
      .hold(UP, 300)
      .spike(UP, v(0, 0, -1), 40)
      .hold(UP, 400)
      .build("noise, gentle sway, knock"));
    expect(kinds(r)).toEqual([]);
  });

  it("needs the phone to settle before the next gesture (no machine-gun repeats)", () => {
    const b = new TraceBuilder().hold(UP, 300);
    for (let i = 0; i < 3; i++) b.burst(UP, v(0, 0, -1), 18).hold(UP, 400);
    expect(kinds(replay(b.build("three separate pushes")))).toEqual(["push", "push", "push"]);
    const tooFast = new TraceBuilder().hold(UP, 300).burst(UP, v(0, 0, -1), 18).burst(UP, v(0, 0, -1), 18).hold(UP, 400);
    expect(kinds(replay(tooFast.build("back-to-back")))).toEqual(["push"]);
  });

  it("measures strength", () => {
    const soft = replay(new TraceBuilder().hold(UP, 300).burst(UP, v(0, 0, -1), 14).hold(UP, 300).build("soft"));
    const hard = replay(new TraceBuilder().hold(UP, 300).burst(UP, v(0, 0, -1), 30).hold(UP, 300).build("hard"));
    expect(hard.gestures[0]!.strength).toBeGreaterThan(soft.gestures[0]!.strength * 1.8);
  });

  it("recognises twists with a gyroscope, and a shake", () => {
    expect(kinds(replay(new TraceBuilder().hold(UP, 300).spin(UP, 400).hold(UP, 300).spin(UP, -400).hold(UP, 300).build("twists")))).toEqual(["twist-left", "twist-right"]);
    const b = new TraceBuilder().hold(UP, 300);
    for (let i = 0; i < 4; i++) b.burst(UP, v(1, 0, 0), 14, 120);
    expect(kinds(replay(b.build("shake")))).toContain("shake");
  });
});

describe("wire format", () => {
  it("TV reader turns counters into actions once, and ignores old counters after a reconnect", () => {
    const tv = new ControlReader();
    expect(tv.update({ taps: { jab: 5, calibrated: 1 } })).toEqual([]);
    expect(tv.calibrations).toBe(1);
    const a = tv.update({ axes: { x: 0.4, y: -0.2, ok: 1, m: 2 / 4 }, taps: { jab: 7, hook: 1, calibrated: 1 }, buttons: { block: true } });
    expect(a).toEqual(["jab", "jab", "hook"]);
    expect([tv.x, tv.y, tv.ok, tv.mode, tv.held("block"), tv.held("jab")]).toEqual([0.4, -0.2, true, 2, true, false]);
    expect(tv.update({ axes: { x: 0.4, ok: 1 }, taps: { jab: 7, hook: 1 } })).toEqual([]);
  });

  it("decodes all five mode codes (buttons … camera) after the phone's 2-decimal clamp", () => {
    for (let code = 0; code <= 4; code++) {
      const tv = new ControlReader();
      const sent = Math.round(Math.max(-1, Math.min(1, code / MODE_DIVISOR)) * 100) / 100; // what InputSender puts on the wire
      tv.update({ axes: { m: sent } });
      expect(tv.mode).toBe(code);
    }
    expect(MODE_DIVISOR).toBe(4);
  });

  it("falls back to tilt for movement when x/y are absent", () => {
    const tv = new ControlReader();
    tv.update({ axes: { roll: 0.5, pitch: -0.3, ok: 1 } });
    expect([tv.x, tv.y]).toEqual([0.5, -0.3]);
  });

  it("a phone that reloads (counters restart at zero) keeps working after a reconnect", () => {
    const tv = new ControlReader();
    tv.update({ taps: { boost: 7 } });
    tv.update({ taps: { boost: 8 } });
    expect(tv.update({ taps: { boost: 0 } })).toEqual([]);           // reload detected: new baseline
    expect(tv.update({ taps: { boost: 1 } })).toEqual(["boost"]);
    tv.clear();                                                       // disconnect
    expect(tv.update({ taps: { boost: 1 } })).toEqual([]);
    expect(tv.update({ taps: { boost: 2 } })).toEqual(["boost"]);
  });

  it("frameAxes reports ok only when calibrated and live, and mirrors tilt as movement", () => {
    const e = new MotionEngine();
    e.push({ t: 16, gravity: UP });
    expect(frameAxes(e.frame(16))).toMatchObject({ ok: 1, x: 0, y: 0 });
    expect(frameAxes(e.frame(2000)).ok).toBe(0);
  });
});

describe("hold to select", () => {
  it("maps tilt to zones and selects only after holding still in one", () => {
    expect([-1, -0.6, -0.1, 0.2, 0.7, 1].map((x) => zoneOf(x, 4))).toEqual([0, 0, 1, 2, 3, 3]);
    const h = new HoldTimer(900);
    expect(h.update(1, 0)).toBeNull();
    expect(h.update(2, 500)).toBeNull();      // moved on: timer restarts
    expect(h.update(2, 1300)).toBeNull();
    expect(h.update(2, 1400)).toBe(2);
    expect(h.update(2, 2500)).toBeNull();     // fires once
  });
});

describe("screen axes", () => {
  it("maps device axes to screen axes for every orientation", () => {
    const a = v(1, 2, 3);
    expect(toScreen(a, 0)).toEqual(v(1, 2, 3));
    expect(toScreen(a, 90)).toEqual(v(-2, 1, 3));   // landscape, rotated counter-clockwise
    expect(toScreen(a, 270)).toEqual(v(2, -1, 3));  // landscape, rotated clockwise
    expect(toScreen(a, 180)).toEqual(v(-1, -2, 3));
  });
});
