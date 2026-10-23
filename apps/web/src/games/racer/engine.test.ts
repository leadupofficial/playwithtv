import { describe, expect, it } from "vitest";
import { GATE_GAP, centreAt, makeTrack, newRace, standings, stepRace, type Controls, type Race, type RaceEvent } from "./engine";

const idle: Controls = { steer: 0, climb: 0, boost: false };

function fly(race: Race, secs: number, ctl: (id: string, r: Race) => Controls) {
  const ev: RaceEvent[] = [];
  for (let t = 0; t < secs && !race.over; t += 1 / 60) {
    ev.push(...stepRace(race, 1 / 60, new Map(race.ships.map((s) => [s.id, ctl(s.id, race)]))));
  }
  return ev;
}

/** A perfect pilot: steers towards the next gate. */
const autopilot = (id: string, r: Race): Controls => {
  const s = r.ships.find((x) => x.id === id)!;
  const g = r.track.gates[Math.min(s.nextGate, r.track.gates.length - 1)]!;
  return { steer: Math.max(-1, Math.min(1, (g.x - s.x) * 0.8)), climb: Math.max(-1, Math.min(1, (s.y - g.y) * 0.8)), boost: false };
};

describe("sky gyro racer", () => {
  it("builds a course of gates with rocks between some of them", () => {
    const t = makeTrack(10);
    expect(t.gates).toHaveLength(10);
    expect(t.rocks.length).toBeGreaterThan(2);
    expect(t.length).toBe(10 * GATE_GAP);
    expect(centreAt(t, GATE_GAP).x).toBeCloseTo(t.gates[0]!.x);
  });

  it("steering and climbing move the ship; tipping the top edge away dives", () => {
    const r = newRace(makeTrack(5), ["a"]);
    fly(r, 0.5, () => ({ steer: 1, climb: 1, boost: false }));
    expect(r.ships[0]!.x).toBeGreaterThan(4);
    expect(r.ships[0]!.y).toBeLessThan(-3);
  });

  it("a pilot who aims at the gates flies through all of them and finishes", () => {
    const r = newRace(makeTrack(6), ["a"]);
    const ev = fly(r, 30, autopilot);
    expect(r.ships[0]!.gatesHit).toBe(6);
    expect(ev.some((e) => e.kind === "finish")).toBe(true);
    expect(r.over).toBe(true);
  });

  it("missing gates still finishes (no crash-outs) but earns less", () => {
    const r = newRace(makeTrack(6), ["a"]);
    fly(r, 30, () => ({ steer: 1, climb: 0, boost: false }));  // hug the right wall
    expect(r.ships[0]!.finishedAt).not.toBeNull();
    expect(r.ships[0]!.gatesHit).toBeLessThan(6);
  });

  it("boost uses energy and speeds the ship up", () => {
    const a = newRace(makeTrack(6), ["a"]);
    const b = newRace(makeTrack(6), ["a"]);
    const ev = fly(a, 1.5, () => ({ ...idle, boost: true }));
    fly(b, 1.5, () => idle);
    expect(ev.filter((e) => e.kind === "boost")).toHaveLength(2); // second boost after the first ends
    expect(a.ships[0]!.dist).toBeGreaterThan(b.ships[0]!.dist + 8);
    expect(a.ships[0]!.energy).toBeLessThan(1);
  });

  it("hitting a rock slows the ship down", () => {
    const t = makeTrack(6);
    const rock = t.rocks[0]!;
    const r = newRace(t, ["a"]);
    r.ships[0]!.x = rock.x;
    r.ships[0]!.y = rock.y;
    const ev = fly(r, (-rock.z / 30) + 0.5, () => idle);
    expect(ev.some((e) => e.kind === "bump")).toBe(true);
  });

  it("ranks finishers by time and gives trailing ships a catch-up", () => {
    const r = newRace(makeTrack(4), ["fast", "slow"]);
    r.ships[1]!.dist = -120; // far behind at the start
    fly(r, 60, (id, race) => ({ ...autopilot(id, race), boost: id === "fast" }));
    const st = standings(r);
    expect(st[0]!.playerId).toBe("fast");
    expect(st[0]!.score).toBeGreaterThan(st[1]!.score);
    expect(r.ships.every((s) => s.finishedAt !== null)).toBe(true);
  });
});
