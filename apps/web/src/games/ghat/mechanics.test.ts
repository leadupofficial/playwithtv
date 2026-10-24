import { describe, expect, it } from "vitest";
import { buildTrack, frameAt } from "./track";
import { HAIRPIN_GHAT } from "./course";
import { BOOST_COST, DRIFT_LEVELS, IDLE, KINDS, drive, driftLevel, newRacer, type DriveEvent, type Racer, type RacerInput } from "./racer";
import { racerContacts, trafficContacts, goatContacts, type ContactEvent } from "./contact";
import { rollItem, stepCoconuts, ITEMS } from "./items";
import { DT, QUICK, newRace, step } from "./race";
import { spawnGoats, type Traffic } from "./traffic";

const t = buildTrack(HAIRPIN_GHAT);
const go = (r: Racer, inp: RacerInput, seconds: number, ev: DriveEvent[] = []) => {
  for (let i = 0; i < seconds / DT; i++) drive(t, r, inp, DT, ev);
  return ev;
};

describe("driving", () => {
  it("auto-gas reaches top speed on the start straight; steering right moves right", () => {
    const r = newRacer("a", 0, "auto", false, 0, 0);
    go(r, IDLE, 3.5);
    expect(r.v).toBeGreaterThan(KINDS.auto.vmax * 0.85);
    const d0 = r.d;
    go(r, { ...IDLE, steer: 1 }, 0.4);
    expect(r.d).toBeGreaterThan(d0 + 0.5);
  });

  it("the rails keep you on the road and report the scrape", () => {
    const r = newRacer("a", 0, "car", false, 0, 0);
    const ev = go(r, { ...IDLE, steer: 1 }, 3);
    expect(Math.abs(r.d)).toBeLessThanOrEqual(frameAt(t, r.s).hw);
    expect(ev.some((e) => e.kind === "wall")).toBe(true);
  });

  it("a held drift charges blue → orange → purple and releasing fires a mini-turbo", () => {
    // into hairpin 1 (a left turn) from the outside
    const hairpin = HAIRPIN_GHAT.segments.slice(0, 3).reduce((a, s) => a + s.len, 0);
    const r = newRacer("a", 0, "scooter", false, hairpin - 12, 3);
    r.v = 28;
    r.y = frameAt(t, r.s).y;
    const ev: DriveEvent[] = [];
    go(r, { ...IDLE, steer: -1, drift: true }, 0.1, ev); // start (left)
    expect(r.drift).toBe(-1);
    for (let i = 0; i < 200 && driftLevel(r) < 3; i++) go(r, { ...IDLE, steer: -0.25 + r.d * 0.1, drift: true }, DT, ev);
    expect(driftLevel(r)).toBe(3);
    expect(ev.filter((e) => e.kind === "driftLevel").map((e) => (e as { level: number }).level).slice(-3)).toEqual([1, 2, 3]);
    expect(r.driftT).toBeGreaterThanOrEqual(DRIFT_LEVELS[2]);
    go(r, IDLE, DT, ev);
    expect(ev).toContainEqual({ kind: "turbo", id: "a", level: 3 });
    expect(r.turboT).toBeGreaterThan(1);
  });

  it("a short drift gives nothing; BOOST spends one meter segment", () => {
    const r = newRacer("a", 0, "auto", false, 0, 0);
    go(r, IDLE, 2);
    const ev = go(r, { ...IDLE, steer: 1, drift: true }, 0.3);
    go(r, IDLE, DT, ev);
    expect(ev.some((e) => e.kind === "turbo")).toBe(false);
    r.meter = 0.7;
    go(r, { ...IDLE, boost: true }, DT, ev);
    expect(r.boostT).toBeGreaterThan(1);
    expect(r.meter).toBeCloseTo(0.7 - BOOST_COST, 5);
  });

  it("flies off the tea-estate crests", () => {
    const start = HAIRPIN_GHAT.segments.slice(0, 10).reduce((a, s) => a + s.len, 0);
    const r = newRacer("a", 0, "auto", false, start - 30, 0);
    r.v = 33;
    r.y = frameAt(t, r.s).y;
    const ev = go(r, IDLE, 7);
    expect(ev.some((e) => e.kind === "air")).toBe(true);
    expect(ev.some((e) => e.kind === "land" && e.airT > 0.25)).toBe(true);
  });
});

describe("contacts and takedowns", () => {
  it("a barge from the side shoves the victim, who is credited as taken down when they hit the rail", () => {
    const a = newRacer("att", 0, "car", false, 50, 0);
    const b = newRacer("vic", 1, "scooter", false, 50, 1.1);
    a.v = b.v = 30;
    a.a = 0.25; // steering into b
    const ev: ContactEvent[] = [];
    racerContacts([a, b], 10, ev);
    expect(ev[0]).toMatchObject({ kind: "bump", side: true });
    expect(b.push).toBeGreaterThan(2);
    expect(b.lastHitBy).toBe("att");
    // then the race sees b slam the rail
    const race = newRace([{ id: "att", cpu: false, kind: "car" }, { id: "vic", cpu: false, kind: "scooter" }], { ...QUICK, introSeconds: 0, countdownSeconds: 0 });
    step(race, DT, new Map());
    step(race, DT, new Map());
    const [ra, rb] = race.racers;
    Object.assign(ra!, { s: 80, d: 2, v: 30, a: 0 });
    Object.assign(rb!, { s: 80, d: 6.8, v: 30, a: 0.3, push: 6, lastHitBy: "att", lastHitAt: race.time });
    const out = step(race, DT, new Map());
    expect(out.some((e) => e.kind === "takedown" && e.by === "att" && e.victim === "vic")).toBe(true);
    expect(rb!.wreckT).toBeGreaterThan(0);
    expect(ra!.stats.takedowns).toBe(1);
  });

  it("hitting a bus wrecks you; passing close by is a near miss", () => {
    const bus: Traffic = { id: 0, kind: "bus", s: 100, d: 3, v: 15, dir: -1, lane: 0.4, verge: 0, look: 0 };
    const hit = newRacer("a", 0, "auto", false, 100, 2.5);
    hit.v = 30;
    const close = newRacer("b", 1, "auto", false, 100, 3 - 1.25 - 0.7 - 0.6);
    close.v = 30;
    const ev: ContactEvent[] = [];
    trafficContacts(t, [hit, close], [bus], 5, new Map(), ev);
    expect(ev).toContainEqual(expect.objectContaining({ kind: "crash", id: "a" }));
    expect(ev).toContainEqual(expect.objectContaining({ kind: "nearMiss", id: "b", oncoming: true }));
    expect(hit.wreckT).toBeGreaterThan(0);
  });

  it("goats spin you out but walk away", () => {
    const goats = spawnGoats(t, 300, () => 0.3, 0);
    const g = goats[0]!;
    const r = newRacer("a", 0, "auto", false, g.s, g.d);
    r.v = 25;
    const ev: ContactEvent[] = [];
    goatContacts(t, [r], goats, () => 0.9, ev);
    expect(ev[0]).toMatchObject({ kind: "goat", id: "a" });
    expect(r.spinT).toBeGreaterThan(0);
    expect(g.bumped).toBeGreaterThan(0);
  });

  it("a wrecked racer is back on the road, shielded, within ~1.5 s", () => {
    const race = newRace([{ id: "a", cpu: false, kind: "auto" }], { ...QUICK, introSeconds: 0, countdownSeconds: 0 });
    step(race, DT, new Map());
    step(race, DT, new Map());
    const r = race.racers[0]!;
    r.s = 200;
    r.v = 30;
    r.wreckT = 1.25;
    let back = -1;
    for (let i = 0; i < 120; i++) if (step(race, DT, new Map()).some((e) => e.kind === "respawn")) { back = i * DT; break; }
    expect(back).toBeGreaterThan(1);
    expect(back).toBeLessThan(1.5);
    expect(r.shieldT).toBeGreaterThan(1);
    expect(r.v).toBeGreaterThan(15);
  });
});

describe("items", () => {
  it("leaders mostly get defence, the back of the pack mostly speed", () => {
    const tally = (place: number) => {
      const n: Record<string, number> = {};
      for (let i = 0; i < 1000; i++) {
        const k = rollItem(place, 6, i / 1000);
        n[k] = (n[k] ?? 0) + 1;
      }
      return n;
    };
    const first = tally(1), last = tally(6);
    expect((first.coconut ?? 0) + (first.splash ?? 0)).toBeGreaterThan((last.coconut ?? 0) + (last.splash ?? 0));
    expect(last.chai ?? 0).toBeGreaterThan(first.chai ?? 0);
    for (const k of ITEMS) expect((first[k] ?? 0) + (last[k] ?? 0)).toBeGreaterThan(0);
  });

  it("a coconut rolls back at the racer behind", () => {
    const list = [{ s: 100, d: 0, sv: 5, dv: 0, life: 8, owner: "a", spin: 0 }];
    const target = { id: "b", s: 80, d: 3 };
    let alive = list;
    for (let i = 0; i < 60; i++) alive = stepCoconuts(t, alive, DT, [target]);
    expect(alive[0]!.d).toBeGreaterThan(0.5);
  });

  it("splash blinds the racers just behind; the horn sends traffic to the verge; chai boosts", () => {
    const race = newRace([{ id: "a", cpu: false, kind: "auto" }, { id: "b", cpu: false, kind: "car" }, { id: "c", cpu: false, kind: "scooter" }], { ...QUICK, introSeconds: 0, countdownSeconds: 0 });
    step(race, DT, new Map());
    step(race, DT, new Map());
    const [a, b, c] = race.racers;
    Object.assign(a!, { s: 300, d: 0, v: 30, item: "splash", rollT: 0 });
    Object.assign(b!, { s: 280, d: 2, v: 30 });
    Object.assign(c!, { s: 200, d: -2, v: 30 });
    let ev = step(race, DT, new Map([["a", { ...IDLE, item: true }]]));
    expect(ev).toContainEqual(expect.objectContaining({ kind: "splashed", id: "b", by: "a" }));
    expect(b!.blindT).toBeGreaterThan(2);
    expect(c!.blindT).toBe(0);
    const ahead = race.traffic[0]!;
    ahead.s = (a!.s + 40) % race.track.length;
    Object.assign(a!, { item: "horn", rollT: 0 });
    ev = step(race, DT, new Map([["a", { ...IDLE, item: true }]]));
    expect(ev).toContainEqual(expect.objectContaining({ kind: "item", item: "horn" }));
    expect(ahead.verge).toBeGreaterThan(4);
    Object.assign(a!, { item: "chai", rollT: 0 });
    step(race, DT, new Map([["a", { ...IDLE, item: true }]]));
    expect(a!.turboT).toBeGreaterThan(1.5);
  });
});
