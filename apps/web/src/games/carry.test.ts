import { describe, expect, it } from "vitest";
import { COLS, LEVELS, ROWS } from "./carry-home/levels";
import { CarrySim, fits, parse, type P } from "./carry-home/sim";

/** Breadth-first search over sofa positions (quarter cells) and angles (16): can it reach home at all? */
function solvable(map: string[], len: number, start: { a: P; b: P }): boolean {
  const STEPS = 16;
  const key = (x: number, y: number, k: number) => `${x},${y},${k}`;
  const ends = (x: number, y: number, k: number): [P, P] => {
    const t = (k / STEPS) * Math.PI * 2;
    const ux = (Math.cos(t) * len) / 2, uy = (Math.sin(t) * len) / 2;
    return [{ x: x / 4 - ux, y: y / 4 - uy }, { x: x / 4 + ux, y: y / 4 + uy }];
  };
  const mx = Math.round(((start.a.x + start.b.x) / 2) * 4), my = Math.round(((start.a.y + start.b.y) / 2) * 4);
  const k0 = Math.round(((Math.atan2(start.b.y - start.a.y, start.b.x - start.a.x) / (Math.PI * 2)) * STEPS + STEPS) % STEPS);
  const seen = new Set([key(mx, my, k0)]);
  const queue: Array<[number, number, number]> = [[mx, my, k0]];
  while (queue.length) {
    const [x, y, k] = queue.shift()!;
    if (map[Math.floor(y / 4)]![Math.floor(x / 4)] === "D") return true;
    for (const [dx, dy, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const n: [number, number, number] = [x + dx, y + dy, (k + dk + STEPS) % STEPS];
      const id = key(...n);
      if (seen.has(id)) continue;
      seen.add(id);
      const [a, b] = ends(...n);
      if (fits(map, a, b, true)) queue.push(n);
    }
  }
  return false;
}

describe("Carry Me Home levels", () => {
  for (const [i, l] of LEVELS.entries()) {
    it(`${i + 1}. ${l.name}: right size, walled, one sofa, a home, and a route the sofa fits along`, () => {
      expect(l.map).toHaveLength(ROWS);
      for (const r of l.map) expect(r).toHaveLength(COLS);
      expect(l.map[0]).toMatch(/^#+$/);
      expect(l.map[ROWS - 1]).toMatch(/^#+$/);
      for (const r of l.map) expect(r[0] === "#" && r[COLS - 1] === "#").toBe(true);
      const flat = l.map.join("");
      expect(flat.split("A")).toHaveLength(2);
      expect(flat.split("B")).toHaveLength(2);
      expect(flat).toContain("D");
      const p = parse(l);
      const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
      expect(len).toBeGreaterThanOrEqual(2.5);
      expect(len).toBeLessThanOrEqual(3.5);
      expect(fits(l.map, p.a, p.b, true)).toBe(true);
      expect(solvable(l.map, len, p)).toBe(true);
      if (flat.includes("=")) expect(l.cars).toBeGreaterThan(0);
    });
  }
});

/** Steers both players towards a target for `ms`. */
function walk(s: CarrySim, a: [number, number], b: [number, number], ms: number) {
  for (let t = 0; t < ms; t += 16) {
    s.steer(0, a[0], a[1]);
    s.steer(1, b[0], b[1]);
    s.step(16);
  }
}
const ends = (s: CarrySim) => s.debug().ends as P[];
const length = (e: P[]) => Math.hypot(e[1]!.x - e[0]!.x, e[1]!.y - e[0]!.y);

describe("Carry Me Home sofa", () => {
  const level = LEVELS[0]!;
  it("walks at full speed when both push the same way", () => {
    const s = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    const x0 = ends(s)[0]!.y;
    walk(s, [0, -1], [0, -1], 500); // down the screen
    expect(ends(s)[0]!.y - x0).toBeCloseTo(4.2 * 0.5, 0);
  });
  it("one player alone only drags it at half speed, and the sofa keeps its length", () => {
    const s = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    const l0 = length(ends(s));
    const a0 = ends(s)[0]!.x, b0 = ends(s)[1]!.x;
    walk(s, [-1, 0], [0, 0], 400); // A pulls along the sofa, away from B
    expect(a0 - ends(s)[0]!.x).toBeCloseTo(4.2 * 0.4 * 0.5, 0);
    expect(b0 - ends(s)[1]!.x).toBeCloseTo(4.2 * 0.4 * 0.5, 0);
    expect(length(ends(s))).toBeCloseTo(l0, 1);
  });
  it("pivots round a partner who stands still", () => {
    const s = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    const b0 = { ...ends(s)[1]! };
    walk(s, [0, -1], [0, 0], 250); // end A walks down (sideways to the sofa), B stays
    const e = ends(s);
    expect(e[0]!.y).toBeGreaterThan(b0.y + 0.3); // A swung round…
    expect(Math.hypot(e[1]!.x - b0.x, e[1]!.y - b0.y)).toBeLessThan(0.5); // …and B barely moved
  });
  it("scrapes count when the sofa is pushed into a wall, and it does not go through", () => {
    const s = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    walk(s, [0, 1], [0, 1], 2000); // up into the top wall
    expect(ends(s)[0]!.y).toBeGreaterThan(1);
    expect(s.debug().scrapes).toBeGreaterThan(0);
  });
  it("delivers home and scores three stars for a clean quick trip", () => {
    const s = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    const home = s.debug().home as P;
    for (let t = 0; t < 20_000 && !s.outcome(); t += 16) {
      const m = s.debug().mid as P;
      // avoid the box in the middle: go down the left side first, then across
      const target = m.y < 9.5 ? { x: 3, y: 10 } : home;
      const dx = target.x - m.x, dy = target.y - m.y, d = Math.hypot(dx, dy) || 1;
      s.steer(0, dx / d, -dy / d);
      s.steer(1, dx / d, -dy / d);
      s.step(16);
    }
    const o = s.outcome()!;
    expect(o.won).toBe(true);
    expect(o.stars).toBe(3);
    expect(o.score).toBeGreaterThan(1000);
  });
  it("a car hit costs a life and sends the sofa back; three end the level", () => {
    const street = LEVELS.find((l) => l.cars)!;
    const s = new CarrySim(street, 7, "", ["#f00", "#00f"]);
    for (let t = 0; t < 60_000 && !s.outcome(); t += 16) {
      const y = (s.debug().mid as P).y;
      const go = y < 3.6 ? -1 : 0; // walk down onto the road and stand in the traffic
      s.steer(0, 0, go);
      s.steer(1, 0, go);
      s.step(16);
    }
    expect(s.outcome()?.won).toBe(false);
    expect(s.debug().lives).toBe(0);
  });
  it("walking in step builds a teamwork streak that speeds you up and scores; out of step it fades", () => {
    const together = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    const apart = new CarrySim(level, 1, "", ["#f00", "#00f"]);
    walk(together, [0, -1], [0, -1], 1500);
    walk(apart, [0, -1], [0.7, -0.7], 1500); // roughly the same way, but not in step
    expect(together.debug().sync).toBeGreaterThan(1);
    expect(apart.debug().sync).toBe(0);
    expect(together.hud().score).toBeGreaterThan(0);
    walk(together, [0, 0], [0, 0], 1000);
    expect(together.debug().sync).toBe(0);
  });
  it("plays alone: the second end follows like a trailer", () => {
    const s = new CarrySim(level, 1, "", ["#f00"]);
    const b0 = ends(s)[1]!.x;
    walk(s, [-1, 0], [0, 0], 400); // A walks away from B (left)
    expect(ends(s)[1]!.x).toBeLessThan(b0 - 1);
  });
});
