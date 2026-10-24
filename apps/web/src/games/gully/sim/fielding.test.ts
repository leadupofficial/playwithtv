import { describe, expect, it } from "vitest";
import { defaultFielders, fielderAt, playOut, WINDOW_BONUS } from "./fielding";
import { LANE, rng } from "./lane";

const at = { x: 0, y: 0.6, z: LANE.contactZ };
const nobody = [{ x: 0, y: 0, z: 40 }]; // one fielder far away (behind the back wall)
const always = () => 0.01;
const never = () => 0.99;

/** Launch velocity from speed, horizontal direction (+ = off side) and loft. */
function vel(speed: number, dir: number, loft: number) {
  const h = Math.cos(loft) * speed;
  return { x: Math.sin(dir) * h, y: Math.sin(loft) * speed, z: -Math.cos(dir) * h };
}

describe("the ball after the bat", () => {
  it("a big straight hit clears the boundary on the full: SIX", () => {
    const p = playOut(at, vel(28, 0, 0.6), nobody, never);
    expect(p.kind).toBe("six");
    expect(p.runs).toBe(6);
    expect(p.bounces).toBe(0);
    expect(p.landing!.z).toBeLessThanOrEqual(LANE.boundaryZ);
  });

  it("along the ground past everyone: FOUR", () => {
    const p = playOut(at, vel(22, 0, 0.05), nobody, never);
    expect(p.kind).toBe("four");
    expect(p.bounces).toBeGreaterThan(0);
  });

  it("onto a balcony on the full is six; lower off the wall is back in play", () => {
    const high = playOut(at, vel(22, 0.9, 0.55), nobody, never);
    expect(["six", "window"]).toContain(high.kind);
    const low = playOut(at, vel(12, 1.2, 0.05), nobody, never);
    expect(low.events.some((e) => e.kind === "wall")).toBe(true);
    expect(["runs", "dot", "four"]).toContain(low.kind);
  });

  it("smashing a neighbour's window on the full is a six plus bonus runs", () => {
    // aim at the middle of the off-side window: x = 5 at z ≈ -11.7, height ≈ 4.4 m
    const w = LANE.windows[0]!;
    const zMid = (w.z0 + w.z1) / 2;
    const dx = LANE.halfWidth, dz = zMid - at.z;
    const dir = Math.atan2(dx, -dz);
    const dist = Math.hypot(dx, dz);
    // fly flat and fast enough that drag and gravity leave it at window height
    let hit = null;
    for (let loft = 0.2; loft < 0.9 && !hit; loft += 0.01) {
      const p = playOut(at, vel(24, dir, loft), nobody, never);
      if (p.kind === "window") hit = p;
    }
    expect(dist).toBeGreaterThan(5);
    expect(hit).not.toBeNull();
    expect(hit!.runs + hit!.bonus).toBe(6 + WINDOW_BONUS);
  });

  it("a catch in the air at a fielder, or dropped", () => {
    const f = [{ x: 0, y: 0, z: -9 }];
    const caught = playOut(at, vel(11, 0, 0.35), f, always);
    expect(caught.kind).toBe("caught");
    expect(caught.fielder).toBe(0);
    const dropped = playOut(at, vel(11, 0, 0.35), f, never);
    expect(dropped.events.some((e) => e.kind === "drop")).toBe(true);
    expect(dropped.kind).not.toBe("caught");
  });

  it("one tip, one hand: a catch after exactly one bounce is out", () => {
    // pops up off the ground near a fielder standing a little deeper than the first bounce
    let found = false;
    for (let z = -4; z > -14 && !found; z -= 0.25) {
      const p = playOut(at, vel(9, 0, 0.5), [{ x: 0, y: 0, z }], always);
      if (p.kind === "one-bounce") {
        found = true;
        expect(p.bounces).toBe(1);
      }
    }
    expect(found).toBe(true);
  });

  it("ground fielding: a soft push is a dot, a ball into the gap is runs", () => {
    const fielders = defaultFielders();
    const push = playOut(at, vel(4, 0.1, 0.05), fielders, never, { defended: true });
    expect(push.kind).toBe("dot");
    const r = rng(11);
    let runs = 0;
    for (let i = 0; i < 40; i++) {
      const p = playOut(at, vel(12 + r() * 6, (r() - 0.5) * 1.6, 0.08), fielders, r);
      if (p.kind === "runs") runs++;
      expect(p.runs).toBeLessThanOrEqual(3);
    }
    expect(runs).toBeGreaterThan(5);
  });

  it("every play ends: path, duration and a fielder for ground balls", () => {
    const r = rng(5);
    for (let i = 0; i < 200; i++) {
      const p = playOut(at, vel(3 + r() * 27, (r() - 0.5) * 3, r() * 1.2 - 0.1), defaultFielders(), r);
      expect(p.duration).toBeGreaterThan(0);
      expect(p.duration).toBeLessThan(12);
      expect(p.path.length).toBeGreaterThan(1);
      if (p.kind === "runs" || p.kind === "dot" || p.kind === "runout") expect(p.fielder).not.toBeNull();
      for (const s of p.path) expect(Math.abs(s.x)).toBeLessThanOrEqual(LANE.halfWidth);
    }
  });

  it("fielders run to the ball and stand still otherwise", () => {
    const fielders = [{ x: 3, y: 0, z: -12 }, { x: -3, y: 0, z: -6 }];
    const p = playOut(at, vel(10, 0.3, 0.05), fielders, never);
    expect(p.fielder).not.toBeNull();
    const who = p.fielder!;
    const home = fielders[who]!;
    expect(fielderAt(p, who, home, 0).running).toBe(false);
    const late = fielderAt(p, who, home, 30);
    expect(late.pos.x).toBeCloseTo(p.fieldAt!.x, 3);
    expect(fielderAt(p, 1 - who, fielders[1 - who]!, 1).pos).toEqual(fielders[1 - who]);
  });
});
