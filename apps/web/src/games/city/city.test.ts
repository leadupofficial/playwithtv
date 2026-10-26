import { describe, expect, it } from "vitest";
import { BOUND, ROAD_HW, buildDistrict, rampAt } from "./district";
import { IDLE, STATS, drive, newCar, speedOf, type CarEvent } from "./car";
import { buildGraph, route } from "./cpu";
import { DT, QUICK, garage, newEvent, placeOf, results, standings, step, type EventEvent } from "./event";

const inside = (b: { x0: number; z0: number; x1: number; z1: number }, x: number, z: number, pad = 0) =>
  x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;

describe("district", () => {
  const d = buildDistrict();
  it("gates, the start grid and the coins are all on open ground", () => {
    for (const p of [...d.gates, ...d.grid, ...d.coins]) {
      for (const b of d.boxes) expect(inside(b, p.x, p.z, 0.8), `${p.x},${p.z} in a building`).toBe(false);
      expect(p.x).toBeGreaterThan(BOUND.min);
      expect(p.x).toBeLessThan(BOUND.max);
    }
    expect(d.gates.length).toBe(8);
    expect(d.boxes.length).toBeGreaterThan(20);
  });
  it("every gate can be reached from the one before it", () => {
    const g = buildGraph(d);
    for (let k = 0; k < d.gates.length; k++) {
      const a = d.gates[k]!, b = d.gates[(k + 1) % d.gates.length]!;
      const path = route(g, g.crossing(a.x / 48, a.z / 48), g.crossing(b.x / 48, b.z / 48));
      expect(path.length).toBeGreaterThan(0);
    }
  });
  it("ramps rise to their crest in the middle", () => {
    const r = d.ramps[0]!;
    expect(rampAt(d, r.x, r.z).h).toBeCloseTo(r.h);
    expect(rampAt(d, r.x + r.len / 2 + 0.1, r.z).h).toBe(0);
  });
});

describe("driving", () => {
  const d = buildDistrict();
  it("gas is automatic: a car gets to near top speed down a street", () => {
    const c = newCar("a", "auto", 0, 180, Math.PI);
    const ev: CarEvent[] = [];
    for (let i = 0; i < 60 * 3; i++) drive(d, c, IDLE, DT, ev);
    expect(speedOf(c)).toBeGreaterThan(STATS.auto.vmax * 0.85);
    expect(c.z).toBeLessThan(150);
  });
  it("a kicker ramp at speed launches the car, and the landing is reported", () => {
    const r = d.ramps[0]!; // on the top street, along x
    const c = newCar("a", "car", r.x - 40, r.z, Math.PI / 2);
    const ev: CarEvent[] = [];
    let maxY = 0;
    for (let i = 0; i < 60 * 4; i++) {
      drive(d, c, IDLE, DT, ev);
      maxY = Math.max(maxY, c.y);
    }
    expect(ev.some((e) => e.kind === "launch")).toBe(true);
    expect(ev.some((e) => e.kind === "land" && e.air > 0.4)).toBe(true);
    expect(maxY).toBeGreaterThan(r.h + 0.8);
  });
  it("driving straight into a building is a crash and the car stays outside it", () => {
    const b = d.boxes[0]!;
    const c = newCar("a", "auto", (b.x0 + b.x1) / 2, b.z0 - ROAD_HW - 30, 0); // facing +z, into the block
    const ev: CarEvent[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      drive(d, c, IDLE, DT, ev);
      expect(inside(b, c.x, c.z)).toBe(false);
    }
    expect(ev.some((e) => e.kind === "crash")).toBe(true);
  });
  it("a held drift charges a mini-turbo", () => {
    const open = { ...d, boxes: [], discs: [] }; // room to drift round in a circle
    const c = newCar("a", "scooter", 96, 150, Math.PI);
    const ev: CarEvent[] = [];
    for (let i = 0; i < 60 * 1.5; i++) drive(open, c, IDLE, DT, ev);
    for (let i = 0; i < 60 * 1.1; i++) drive(open, c, { steer: 0.8, drift: true, boost: false }, DT, ev);
    drive(open, c, IDLE, DT, ev);
    expect(ev.some((e) => e.kind === "turbo")).toBe(true);
    expect(c.boostT).toBeGreaterThan(0);
  });
});

describe("checkpoint rush", () => {
  it("garage picks and locks vehicles, CPUs fill the field to four", () => {
    const e = newEvent(["asha"], { ...QUICK, seed: 3 });
    expect(e.riders.length).toBe(4);
    const ev: EventEvent[] = [];
    garage(e, "asha", { left: false, right: true, ok: false }, ev);
    garage(e, "asha", { left: false, right: false, ok: true }, ev);
    expect(e.riders[0]!.car.kind).toBe("scooter");
    step(e, 1, new Map());
    expect(e.phase).toBe("intro");
  });
  it("four CPUs drive the whole lap through every gate in order, deterministically", () => {
    const run = () => {
      const e = newEvent([], { ...QUICK, seed: 7 });
      const gates: string[] = [];
      for (let i = 0; i < 60 * 200 && e.phase !== "results"; i++) {
        for (const x of step(e, DT, new Map())) if (x.kind === "gate" && x.id === "cpu1") gates.push(String(x.gate));
      }
      return { e, gates };
    };
    const { e, gates } = run();
    expect(e.phase).toBe("results");
    expect(gates).toEqual(["1", "2", "3", "4", "5", "6", "7", "0"]);
    expect(e.riders.filter((r) => r.finishedAt !== null).length).toBeGreaterThanOrEqual(3);
    // a lap of the district takes a CPU about a minute or less
    expect(Math.min(...e.riders.map((r) => r.finishedAt ?? Infinity))).toBeLessThan(80);
    expect(results(e).order).toEqual(results(run().e).order);
    expect(placeOf(e, standings(e)[0]!.id)).toBe(1);
  });
});
