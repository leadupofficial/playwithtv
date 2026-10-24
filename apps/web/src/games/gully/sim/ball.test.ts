import { describe, expect, it } from "vitest";
import { at, crossing, deliver, describePlan, type BowlPlan } from "./delivery";
import { judge, playShot, shotName, WINDOW } from "./shot";
import { LANE, rng } from "./lane";

const exact = () => 0.5; // gauss(exact) = 0: no scatter, no noise
const plan = (p: Partial<BowlPlan> = {}): BowlPlan => ({ line: 0, length: 0.45, kind: "pace", ...p });

describe("a delivery", () => {
  it("leaves the hand, pitches where the length says and reaches the batter, then the stumps", () => {
    const full = deliver(plan({ length: 0.05 }), exact, 0);
    const short = deliver(plan({ length: 0.95 }), exact, 0);
    expect(full.bounce.z).toBeGreaterThan(short.bounce.z); // full pitches nearer the batter
    expect(full.tBounce).toBeGreaterThan(short.tBounce);
    for (const d of [full, short]) {
      expect(d.path[0]!.z).toBeCloseTo(LANE.release.z, 1);
      expect(d.tBounce).toBeLessThan(d.tContact);
      expect(d.tContact).toBeLessThan(d.tStumps);
      expect(at(d.path, d.tBounce).y).toBeLessThan(0.1);
    }
    expect(short.contact.y).toBeGreaterThan(full.contact.y); // a bouncer arrives higher
  });

  it("pace arrives sooner than spin; spin turns after the bounce", () => {
    const pace = deliver(plan({ line: 0.6 }), exact, 0);
    const spin = deliver(plan({ line: 0.6, kind: "spin" }), exact, 0);
    expect(pace.tContact).toBeLessThan(spin.tContact);
    expect(pace.tContact).toBeGreaterThan(0.6); // humans can react: ~0.7–1.2 s from the hand
    expect(spin.tContact).toBeLessThan(1.5);
    expect(pace.turn).toBe(0);
    expect(Math.abs(spin.turn)).toBeGreaterThan(0.1);
    expect(spin.contact.x).toBeCloseTo(0.6 * 0.62, 1); // still finishes on the chosen line
  });

  it("at the stumps hits the bricks; wide of them misses; way outside is a wide", () => {
    expect(deliver(plan({ line: 0, length: 0.3 }), exact, 0).hitsStumps).toBe(true);
    expect(deliver(plan({ line: 0.9 }), exact, 0).hitsStumps).toBe(false);
    expect(deliver(plan({ line: 1.5 }), exact, 0).wide).toBe(true);
    expect(deliver(plan({ line: -0.9 }), exact, 0).wide).toBe(false);
  });

  it("a bouncer at the stumps goes over the brick stack", () => {
    expect(deliver(plan({ line: 0, length: 1 }), exact, 0).hitsStumps).toBe(false);
  });

  it("scatter moves it a little, never wildly", () => {
    const r = rng(7);
    for (let i = 0; i < 50; i++) {
      const d = deliver(plan(), r, 0.05);
      expect(Math.abs(d.plan.line)).toBeLessThan(0.4);
    }
  });

  it("crossing() and at() interpolate between samples", () => {
    const path = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }];
    expect(crossing(path, 0.5)).toBeCloseTo(0.5 / 120);
    expect(at(path, 0.25 / 120).x).toBeCloseTo(0.25);
    expect(at(path, 99).z).toBe(1);
  });

  it("describes the plan for the bowler's phone", () => {
    expect(describePlan(plan({ length: 0.05 })).length).toBe("Yorker");
    expect(describePlan(plan({ length: 0.9 })).length).toBe("Short");
    expect(describePlan(plan({ line: 1.4 })).line).toBe("Wide");
    expect(describePlan(plan({ line: 0.6 })).line).toBe("Off side");
  });
});

describe("timing", () => {
  it("has generous windows: perfect, good, early, late, miss", () => {
    expect(judge(0)).toBe("perfect");
    expect(judge(-WINDOW.perfect)).toBe("perfect");
    expect(judge(-100)).toBe("good");
    expect(judge(-200)).toBe("early");
    expect(judge(70)).toBe("late");
    expect(judge(WINDOW.late + 10)).toBe("miss");
    expect(judge(-WINDOW.early - 10)).toBe("miss");
    expect(judge(-200, true)).toBe("miss"); // reaching for a wide ball: smaller window
  });
});

describe("a shot", () => {
  const d = deliver(plan({ line: 0 }), exact, 0);
  it("perfect + full power goes straight and far; early pulls to the leg side; late goes to the off side", () => {
    const straight = playShot(d, { dtMs: 0, power: 1, loft: 0.5 }, exact);
    const early = playShot(d, { dtMs: -120, power: 1 }, exact);
    const late = playShot(d, { dtMs: 50, power: 1 }, exact);
    expect(straight.contact).toBe(true);
    expect(Math.abs(straight.dir)).toBeLessThan(0.15);
    expect(straight.v0.z).toBeLessThan(-20); // down the lane, fast
    expect(early.dir).toBeLessThan(-0.5);
    expect(late.dir).toBeGreaterThan(0.2);
  });

  it("power sets the speed", () => {
    const soft = playShot(d, { dtMs: 0, power: 0.1 }, exact);
    const hard = playShot(d, { dtMs: 0, power: 1 }, exact);
    expect(hard.speed).toBeGreaterThan(soft.speed * 1.6);
  });

  it("a defensive block drops dead; a miss makes no contact", () => {
    const block = playShot(d, { dtMs: 30, power: 1, defend: true }, exact);
    expect(block.defended).toBe(true);
    expect(block.speed).toBeLessThan(6);
    expect(playShot(d, { dtMs: 400, power: 1 }, exact).contact).toBe(false);
  });

  it("very late swings edge behind; mistimed early ones can sky it", () => {
    const edge = playShot(d, { dtMs: 80, power: 1 }, () => 0.1);
    expect(edge.edge).toBe(true);
    expect(Math.abs(edge.dir)).toBeGreaterThan(2.2); // behind the batter
    const sky = playShot(d, { dtMs: -220, power: 1 }, () => 0.1);
    expect(sky.skied).toBe(true);
    expect(sky.loft).toBeGreaterThan(1);
  });

  it("names shots for the commentary", () => {
    expect(shotName(0, 0.5, false)).toBe("lofted straight drive");
    expect(shotName(-1, 0.3, true)).toBe("pull shot");
    expect(shotName(0.5, 0.1, false)).toBe("cover drive");
    expect(shotName(2.6, 0.1, false)).toBe("edge to third man");
  });
});
