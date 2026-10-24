import { describe, expect, it } from "vitest";
import {
  BOMB_STUN, H, POINTS, SLICE_SPEED, TUNING, W, moveCursor, newBlade, newRound, scores, segDist, segHitsCircle, spawnTarget, stepRound,
  type BladeEvent, type BladeInput, type Round, type Target, type TargetKind,
} from "./engine";

const DT = 1 / 60;
const NONE: BladeInput = { mode: "buttons", ok: true, x: 0, y: 0, slash: null };
const tp = (x: number, y: number): BladeInput => ({ mode: "touchpad", ok: true, x, y, slash: null });
/** Touchpad axes for a screen position. */
const pad = (sx: number, sy: number) => tp((sx / W) * 2 - 1, 1 - (sy / H) * 2);

/** A round with no automatic throwing and hand-placed, motionless targets. */
function lab(ids = ["a"], targets: Array<[TargetKind, number, number]> = []): Round {
  const r = newRound(ids, 1, 60);
  r.spawnT = 1e9;
  for (const [kind, x, y] of targets) {
    const t = spawnTarget(r, kind, x);
    Object.assign<Target, Partial<Target>>(t, { x, y, vx: 0, vy: 0 });
  }
  return r;
}
/** Freezes targets in the air (no gravity) by resetting their speed every step. */
function step(r: Round, inputs: BladeInput[], ev: BladeEvent[] = [], still = true) {
  if (still) for (const t of r.targets) { t.vy = -900 * DT; t.vx = 0; } // gravity adds 900*DT back this step
  stepRound(r, DT, inputs, ev);
  return ev;
}

describe("blade geometry", () => {
  it("measures the distance from a circle's centre to a segment", () => {
    expect(segDist(0, 0, 10, 0, 5, 3)).toBeCloseTo(3);
    expect(segDist(0, 0, 10, 0, -4, 3)).toBeCloseTo(5); // beyond the start: the end point counts
    expect(segDist(0, 0, 0, 0, 3, 4)).toBeCloseTo(5);   // a zero-length segment is a point
  });
  it("a segment crossing a circle hits it; one passing by does not", () => {
    expect(segHitsCircle(0, 100, 300, 100, 150, 120, 30)).toBe(true);
    expect(segHitsCircle(0, 100, 300, 100, 150, 140, 30)).toBe(false);
    expect(segHitsCircle(0, 0, 100, 100, 200, 200, 10)).toBe(false); // on the line but past the end
  });
});

describe("blade: cutting with the touchpad", () => {
  it("a fast drag across a target cuts it and scores", () => {
    const r = lab(["a"], [["plum", 640, 360]]);
    const ev: BladeEvent[] = [];
    step(r, [pad(400, 360)], ev); // touch down: teleport, no cut
    for (let x = 440; x <= 880; x += 40) step(r, [pad(x, 360)], ev);
    const cut = ev.find((e) => e.kind === "cut");
    expect(cut).toMatchObject({ id: "a", target: "plum", points: POINTS.target });
    expect(r.blades[0]!.score).toBe(POINTS.target);
    expect(r.targets).toHaveLength(0);
  });

  it("a slow drag over a target does not cut", () => {
    const r = lab(["a"], [["plum", 640, 360]]);
    step(r, [pad(560, 360)]);
    const ev: BladeEvent[] = [];
    for (let x = 560; x <= 720; x += 4) step(r, [pad(x, 360)], ev); // 240 px/s
    expect(SLICE_SPEED).toBeGreaterThan(400);
    expect(ev.some((e) => e.kind === "cut")).toBe(false);
  });

  it("lifting the finger and touching elsewhere jumps without cutting", () => {
    const r = lab(["a"], [["plum", 640, 360]]);
    step(r, [pad(100, 360)]);
    step(r, [tp(0, 0)]); // finger up
    expect(r.blades[0]!.lifted).toBe(true);
    const ev: BladeEvent[] = [];
    step(r, [pad(1200, 360)], ev);
    step(r, [pad(1200, 360)], ev);
    expect(r.blades[0]!.x).toBeCloseTo(1200, 0);
    expect(ev.some((e) => e.kind === "cut")).toBe(false);
  });

  it("three or more in one stroke is a combo with bonus points", () => {
    const r = lab(["a"], [["plum", 450, 300], ["lemon", 640, 300], ["gourd", 830, 300]]);
    const ev: BladeEvent[] = [];
    step(r, [pad(300, 300)], ev);
    for (let x = 340; x <= 1000; x += 40) step(r, [pad(x, 300)], ev);
    for (let i = 0; i < 20; i++) step(r, [pad(1000, 300)], ev); // stop: the stroke ends
    const combo = ev.find((e) => e.kind === "combo");
    expect(combo).toMatchObject({ n: 3, bonus: 3 * POINTS.comboPer });
    expect(r.blades[0]!.score).toBe(3 * POINTS.target + 3 * POINTS.comboPer);
    expect(r.blades[0]!.bestCombo).toBe(3);
  });

  it("two cuts in separate strokes are no combo", () => {
    const r = lab(["a"], [["plum", 400, 300], ["lemon", 900, 300]]);
    const ev: BladeEvent[] = [];
    step(r, [pad(300, 300)], ev);
    for (let x = 340; x <= 500; x += 40) step(r, [pad(x, 300)], ev);
    for (let i = 0; i < 20; i++) step(r, [pad(500, 300)], ev);
    for (let x = 540; x <= 1000; x += 40) step(r, [pad(x, 300)], ev);
    for (let i = 0; i < 20; i++) step(r, [pad(1000, 300)], ev);
    expect(ev.filter((e) => e.kind === "cut")).toHaveLength(2);
    expect(ev.some((e) => e.kind === "combo")).toBe(false);
  });
});

describe("blade: bombs, golden targets and slashes", () => {
  it("cutting a bomb costs points (never below zero) and stuns the blade", () => {
    const r = lab(["a"], [["bomb", 640, 360], ["plum", 900, 360]]);
    r.blades[0]!.score = 15;
    const ev: BladeEvent[] = [];
    step(r, [pad(500, 360)], ev);
    for (let x = 540; x <= 1000; x += 40) step(r, [pad(x, 360)], ev);
    expect(ev.some((e) => e.kind === "bomb")).toBe(true);
    expect(ev.some((e) => e.kind === "cut")).toBe(false); // stunned: the plum survives
    expect(r.blades[0]!.score).toBe(0);
    expect(r.blades[0]!.bombs).toBe(1);
    for (let i = 0; i < Math.ceil(BOMB_STUN / DT) + 2; i++) step(r, [pad(1000, 360)], ev);
    expect(r.blades[0]!.stunT).toBe(0);
  });

  it("a golden target is worth much more", () => {
    const r = lab(["a"], [["golden", 640, 360]]);
    const ev: BladeEvent[] = [];
    step(r, [pad(500, 360)], ev);
    for (let x = 540; x <= 800; x += 40) step(r, [pad(x, 360)], ev);
    expect(r.blades[0]!.score).toBe(POINTS.golden);
    expect(r.blades[0]!.golden).toBe(1);
  });

  it("a motion flick slashes from the cursor in the flick's direction", () => {
    const r = lab(["a"], [["lantern", 640 + 250, 360]]);
    const b = r.blades[0]!;
    b.x = b.px = 640; b.y = b.py = 360;
    const aim: BladeInput = { mode: "motion", ok: true, x: 0, y: 0, slash: null };
    const ev: BladeEvent[] = [];
    step(r, [{ ...aim, slash: "left" }], ev); // the wrong way: misses
    expect(ev.some((e) => e.kind === "cut")).toBe(false);
    for (let i = 0; i < 20; i++) step(r, [aim], ev);
    step(r, [{ ...aim, slash: "right" }], ev);
    expect(ev.find((e) => e.kind === "slash")).toBeTruthy();
    expect(ev.some((e) => e.kind === "cut")).toBe(true);
  });

  it("buttons slash along the stick, with a cooldown between slashes", () => {
    const r = lab(["a"], [["plum", 640, 360 - 150], ["lemon", 640, 360 - 160]]);
    const b = r.blades[0]!;
    b.x = b.px = 640; b.y = b.py = 360;
    const ev: BladeEvent[] = [];
    step(r, [{ mode: "buttons", ok: true, x: 0, y: 0.001, slash: "aim" }], ev); // no stick: the last direction (up)
    expect(ev.filter((e) => e.kind === "cut")).toHaveLength(2);
    const ev2: BladeEvent[] = [];
    spawnTarget(r, "gourd", 640);
    Object.assign(r.targets[0]!, { x: 640, y: 200, vx: 0, vy: 0 });
    step(r, [{ ...NONE, slash: "aim" }], ev2); // too soon
    expect(ev2.some((e) => e.kind === "slash")).toBe(false);
    for (let i = 0; i < Math.ceil(TUNING.buttons.cool / DT); i++) step(r, [NONE], ev2);
    step(r, [{ ...NONE, slash: "aim" }], ev2);
    expect(ev2.some((e) => e.kind === "cut")).toBe(true);
  });

  it("the joystick moves the cursor and stays on screen", () => {
    const b = newBlade("a", 0, 1);
    for (let i = 0; i < 120; i++) moveCursor(b, { mode: "buttons", ok: true, x: 1, y: 1, slash: null }, DT);
    expect(b.x).toBe(W);
    expect(b.y).toBe(0);
  });

  it("tilting aims the cursor at a place on the screen", () => {
    const b = newBlade("a", 0, 1);
    for (let i = 0; i < 120; i++) moveCursor(b, { mode: "motion", ok: true, x: -1, y: 0, slash: null }, DT);
    expect(b.x).toBeLessThan(W * 0.1);
    expect(b.y).toBeCloseTo(H / 2, 0);
  });
});

describe("blade: the round", () => {
  it("throws targets up in arcs that come back down", () => {
    const r = newRound(["a", "b"], 42, 60);
    const ev: BladeEvent[] = [];
    let highest = H;
    for (let i = 0; i < 60 * 8; i++) {
      stepRound(r, DT, [NONE, NONE], ev);
      for (const t of r.targets) highest = Math.min(highest, t.y);
    }
    expect(r.thrown).toBeGreaterThan(8);
    expect(highest).toBeLessThan(H * 0.5); // they rise well into view
    expect(ev.some((e) => e.kind === "missed")).toBe(true);
    const kinds = new Set<string>();
    const r2 = newRound(["a"], 3, 60);
    for (let i = 0; i < 60 * 60; i++) { stepRound(r2, DT, [NONE], []); for (const t of r2.targets) kinds.add(t.kind); }
    expect(kinds.has("bomb")).toBe(true);
    expect(kinds.has("golden")).toBe(true);
  });

  it("ends at the time limit; nothing is cut after that", () => {
    const r = newRound(["a"], 1, 2);
    for (let i = 0; i < 130; i++) stepRound(r, DT, [NONE], []);
    expect(r.over).toBe(true);
    spawnTarget(r, "plum", 640);
    Object.assign(r.targets[0]!, { x: 640, y: 360, vx: 0, vy: 0 });
    const ev: BladeEvent[] = [];
    step(r, [pad(400, 360)], ev);
    for (let x = 440; x <= 880; x += 40) step(r, [pad(x, 360)], ev);
    expect(ev.some((e) => e.kind === "cut")).toBe(false);
  });

  it("is seedable", () => {
    const a = newRound(["a"], 5, 30), b = newRound(["a"], 5, 30);
    for (let i = 0; i < 300; i++) { stepRound(a, DT, [NONE], []); stepRound(b, DT, [NONE], []); }
    expect(a.targets.map((t) => [t.kind, t.x])).toEqual(b.targets.map((t) => [t.kind, t.x]));
  });

  it("a target goes to one blade only, even when two cross it together", () => {
    const r = lab(["a", "b"], [["plum", 640, 360]]);
    const ev: BladeEvent[] = [];
    step(r, [pad(400, 360), pad(400, 365)], ev);
    for (let x = 440; x <= 880; x += 40) step(r, [pad(x, 360), pad(x, 365)], ev);
    expect(ev.filter((e) => e.kind === "cut")).toHaveLength(1);
    const s = scores(r);
    expect((s.get("a") ?? 0) + (s.get("b") ?? 0)).toBe(POINTS.target);
  });
});
