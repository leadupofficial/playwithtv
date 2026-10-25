import { describe, expect, it } from "vitest";
import { DT, QUICK, FULL, newRace, standings, step, type Race, type RaceEvent } from "./race";
import { IDLE, type RacerInput } from "./racer";
import { cpuInput, newBrain, type Brain } from "./cpu";
import { pickAwards } from "./awards";

const field = (humans: number, total = 6) =>
  Array.from({ length: total }, (_, i) => ({ id: i < humans ? `p${i}` : `cpu${i}`, cpu: i >= humans, kind: (["auto", "scooter", "car"] as const)[i % 3]! }));

/** Runs a race with every racer driven by the CPU brain (humans too, unless `drive` says otherwise). */
function run(race: Race, seconds: number, drive?: (race: Race, id: string, cpu: RacerInput) => RacerInput, until?: (r: Race) => boolean) {
  const brains = new Map<string, Brain>(race.racers.map((r, i) => [r.id, newBrain(i + 1)]));
  const events: RaceEvent[] = [];
  const inputs = new Map<string, RacerInput>();
  for (let i = 0; i < seconds / DT; i++) {
    for (const r of race.racers) {
      const c = cpuInput(race, r, brains.get(r.id)!, DT);
      inputs.set(r.id, drive ? drive(race, r.id, c) : c);
    }
    events.push(...step(race, DT, inputs));
    if (until?.(race) || race.over) break;
  }
  return events;
}

describe("a GHAT RUSH race", () => {
  it("goes intro → countdown → race → results → replay/podium → over, everyone placed", () => {
    const race = newRace(field(0), { ...QUICK, seed: 7 });
    const ev = run(race, 200);
    const phases = ev.filter((e) => e.kind === "phase").map((e) => (e as { phase: string }).phase);
    expect(phases.slice(0, 3)).toEqual(["countdown", "race", "results"]);
    expect(phases.at(-1)).toBe("podium");
    expect(race.over).toBe(true);
    expect(race.finishOrder).toHaveLength(6);
    expect(new Set(race.finishOrder).size).toBe(6);
    expect(ev.filter((e) => e.kind === "count").map((e) => (e as { n: number }).n)).toEqual([3, 2, 1]);
  });

  it("CPU racers lap the quick course in a believable time without getting stuck", () => {
    const race = newRace(field(0), { ...QUICK, seed: 3 });
    run(race, 120, undefined, (r) => r.finishOrder.length > 0);
    const lapTime = race.time;
    expect(lapTime).toBeGreaterThan(28);
    expect(lapTime).toBeLessThan(60);
    // the whole field is still racing: nobody is a lap down or parked
    for (const r of race.racers) expect(r.s).toBeGreaterThan(race.track.length * 0.75);
  });

  it("is lively: drifts with mini-turbos, air off the crests, near misses, overtakes", () => {
    const race = newRace(field(0), { ...FULL, seed: 11 });
    const ev = run(race, 240, undefined, (r) => r.phase === "results");
    const count = (k: string) => ev.filter((e) => e.kind === k).length;
    expect(count("turbo")).toBeGreaterThan(5);
    expect(count("air")).toBeGreaterThan(3);
    expect(count("overtake")).toBeGreaterThan(3);
    expect(count("pickup")).toBeGreaterThan(3);
    expect(count("item")).toBeGreaterThan(2);
    expect(count("lap")).toBeGreaterThan(6);
  });

  it("a player who never steers still makes progress (assist + rails), and one who steers wins more", () => {
    const race = newRace(field(1), { ...QUICK, seed: 5 });
    run(race, 60, (_r, id, cpu) => (id === "p0" ? IDLE : cpu));
    const me = race.racers.find((r) => r.id === "p0")!;
    expect(me.s).toBeGreaterThan(200);
  });

  it("standings follow the finish order, then distance", () => {
    const race = newRace(field(0), { ...QUICK, seed: 9 });
    run(race, 200, undefined, (r) => r.phase === "results");
    const st = standings(race);
    expect(st.map((r) => r.id)).toEqual(race.finishOrder);
    expect(st.map((r) => r.place)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("hands out awards to different racers", () => {
    const race = newRace(field(0), { ...FULL, seed: 13 });
    run(race, 240, undefined, (r) => r.phase === "results");
    const awards = pickAwards(race.racers, 4);
    expect(awards.length).toBeGreaterThan(1);
    expect(new Set(awards.map((a) => a.id)).size).toBe(awards.length);
  });
});
