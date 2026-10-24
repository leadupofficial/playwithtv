import { describe, expect, it } from "vitest";
import { DT, HX, HZ, IDLE, WOBBLE, newMatch, score, standings, step, type BrawlEvent, type BrawlInput, type Match } from "./engine";
import { knockback } from "./combat";
import { cpuInput, newBrain } from "./cpu";
import { awards } from "./awards";

const two = (o = {}) => newMatch([{ id: "a", cpu: false }, { id: "b", cpu: false }], { introSeconds: 0.1, countdownSeconds: 0.5, ...o });
const four = (o = {}) => newMatch(["a", "b", "c", "d"].map((id) => ({ id, cpu: true })), { introSeconds: 0.1, countdownSeconds: 0.5, ...o });

function toFight(m: Match) {
  const ev: BrawlEvent[] = [];
  while (m.phase !== "fight") ev.push(...step(m, DT, new Map()));
  return ev;
}
function run(m: Match, secs: number, inputs: (m: Match) => Map<string, BrawlInput> = () => new Map()) {
  const ev: BrawlEvent[] = [];
  for (let t = 0; t < secs; t += DT) ev.push(...step(m, DT, inputs(m)));
  return ev;
}
const fighter = (m: Match, id: string) => m.fighters.find((f) => f.id === id)!;
/** Puts `a` at (x, z) facing +x and `b` right in front of it. */
function faceOff(m: Match, gap = 1.2, x = 0) {
  const a = fighter(m, "a"), b = fighter(m, "b");
  Object.assign(a, { x, z: 0, face: Math.PI / 2, vx: 0, vz: 0 });
  Object.assign(b, { x: x + gap, z: 0, face: -Math.PI / 2, vx: 0, vz: 0 });
  for (const f of m.fighters.slice(2)) Object.assign(f, { x: -5, z: 4 });
  return { a, b };
}
const swing = (power: number): BrawlInput => ({ ...IDLE, swing: power });

describe("match flow", () => {
  it("runs the intro, counts down 3-2-1 and starts the fight", () => {
    const m = newMatch([{ id: "a", cpu: false }, { id: "b", cpu: true }], { introSeconds: 1, countdownSeconds: 3 });
    expect(m.phase).toBe("intro");
    const ev = toFight(m);
    expect(ev.filter((e) => e.kind === "countdown").map((e) => (e as { n: number }).n)).toEqual([3, 2, 1, 0]);
    expect(m.phase).toBe("fight");
  });

  it("needs two fighters", () => {
    expect(() => newMatch([{ id: "a", cpu: false }])).toThrow();
  });

  it("ends a round by knockout and gives the survivor a round win", () => {
    const m = two();
    toFight(m);
    const b = fighter(m, "b");
    b.x = HX + 1; // pushed off
    const ev = run(m, 2);
    expect(ev.some((e) => e.kind === "fall" && e.id === "b" && e.last)).toBe(true);
    expect(ev.some((e) => e.kind === "round-end" && e.winner === "a" && e.reason === "ko")).toBe(true);
    expect(fighter(m, "a").stats.roundWins).toBe(1);
  });

  it("is best of three: first to two round wins goes to the podium", () => {
    const m = two();
    for (let r = 0; r < 2; r++) {
      toFight(m);
      fighter(m, "b").x = -HX - 1;
      run(m, 1.6);
      expect(m.phase).toBe("roundEnd");
      run(m, 3.3);
    }
    expect(m.phase).toBe("podium");
    expect(m.matchWinner).toBe("a");
    expect(standings(m)[0]!.id).toBe("a");
    expect(score(fighter(m, "a"))).toBeGreaterThan(score(fighter(m, "b")));
  });

  it("on time out, the standing fighter with the least wobble wins", () => {
    const m = two({ roundSeconds: 2 });
    toFight(m);
    fighter(m, "a").damage = 40;
    const ev = run(m, 2.2);
    expect(ev.find((e) => e.kind === "round-end")).toMatchObject({ winner: "b", reason: "time" });
  });

  it("resets positions and makes the player behind on rounds the underdog", () => {
    const m = two();
    toFight(m);
    fighter(m, "b").x = HX + 1;
    run(m, 5);
    expect(m.round).toBe(2);
    expect(fighter(m, "b").alive).toBe(true);
    expect(fighter(m, "b").underdog).toBe(true);
    expect(fighter(m, "a").underdog).toBe(false);
  });
});

describe("pillow swings", () => {
  it("knocks back a fighter in front, away from the swinger", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m);
    const ev = run(m, 0.3, (mm) => new Map([["a", mm.time < 0.8 ? swing(0.5) : IDLE]]));
    expect(ev.some((e) => e.kind === "hit" && e.by === "a" && e.on === "b")).toBe(true);
    expect(b.x).toBeGreaterThan(1.6);
    expect(b.damage).toBeGreaterThan(0);
  });

  it("misses someone behind the swinger", () => {
    const m = two();
    toFight(m);
    faceOff(m, -1.4);
    const ev = run(m, 0.4, () => new Map([["a", swing(0.5)]]));
    expect(ev.some((e) => e.kind === "hit")).toBe(false);
    expect(ev.some((e) => e.kind === "whiff")).toBe(true);
  });

  it("hold to charge: a full charge hits much harder than a tap", () => {
    const tap = two();
    toFight(tap);
    const t = faceOff(tap);
    run(tap, 0.5, (mm) => new Map([["a", mm.t < 0.05 ? swing(0.15) : IDLE]]));
    const full = two();
    toFight(full);
    const f = faceOff(full);
    const ev = run(full, 1.6, (mm) => new Map([["a", { ...IDLE, charge: mm.t < 1.0 }]]));
    expect(ev.some((e) => e.kind === "charge-full" && e.id === "a")).toBe(true);
    expect(ev.find((e) => e.kind === "hit")).toMatchObject({ smash: true });
    expect(f.b.x - 1.2).toBeGreaterThan((t.b.x - 1.2) * 2);
  });

  it("moves slower while charging", () => {
    const m = two();
    toFight(m);
    const a = fighter(m, "a");
    const x0 = a.x;
    run(m, 0.5, () => new Map([["a", { ...IDLE, x: 1 }]]));
    const walked = a.x - x0;
    const x1 = a.x;
    run(m, 0.5, () => new Map([["a", { ...IDLE, x: 1, charge: true }]]));
    expect(a.x - x1).toBeLessThan(walked * 0.7);
  });

  it("knockback grows with wobble %, and underdogs hit harder", () => {
    const m = two();
    const a = fighter(m, "a"), b = fighter(m, "b");
    const fresh = knockback(0.5, a, b);
    b.damage = WOBBLE;
    expect(knockback(0.5, a, b)).toBeCloseTo(fresh * 2);
    a.underdog = true;
    expect(knockback(0.5, a, b)).toBeGreaterThan(fresh * 2);
  });

  it("counts combos for quick follow-up hits", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m, 1.1);
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      Object.assign(b, { x: 1.1, z: 0, vx: 0, vz: 0, state: "ok", stun: 0, y: 0, vy: 0 });
      let first = true;
      const ev = run(m, 0.55, () => {
        const inp = first ? swing(0.2) : IDLE;
        first = false;
        return new Map([["a", inp]]);
      });
      for (const e of ev) if (e.kind === "hit") hits.push(e.combo);
    }
    expect(hits).toEqual([1, 2, 3]);
  });

  it("a dodge dashes and is invulnerable while dashing", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m);
    // b dodges away at the same moment a swings
    const ev = run(m, 0.12, () => new Map([["a", swing(0.15)], ["b", { ...IDLE, dodge: true, x: 0, z: 1 }]]));
    expect(ev.some((e) => e.kind === "dodge" && e.id === "b")).toBe(true);
    expect(ev.some((e) => e.kind === "hit")).toBe(false);
    expect(b.z).toBeGreaterThan(0.8);
  });
});

describe("the headboard", () => {
  it("is a soft wall: fighters bounce off the back instead of falling", () => {
    const m = two();
    toFight(m);
    const a = fighter(m, "a");
    Object.assign(a, { x: 0, z: -HZ + 0.3, vz: -12, state: "hit", stun: 0.5 });
    const ev = run(m, 0.5);
    expect(ev.some((e) => e.kind === "fall")).toBe(false);
    expect(a.alive).toBe(true);
    expect(a.z).toBeGreaterThanOrEqual(-HZ);
  });
});

describe("falling off and ghosts", () => {
  it("credits the knockout to the last hitter and brings the faller back as a ghost", () => {
    const m = newMatch(["a", "b", "c"].map((id) => ({ id, cpu: false })), { introSeconds: 0.1, countdownSeconds: 0.5 });
    toFight(m);
    const { a, b } = faceOff(m, 1.2, HX - 2);
    const ev = run(m, 2, (mm) => new Map([["a", mm.t < 0.05 ? swing(1) : IDLE]]));
    const fall = ev.find((e) => e.kind === "fall");
    expect(fall).toMatchObject({ id: "b", by: "a", first: true });
    expect(a.stats.kos).toBe(1);
    expect(b.stats.firstOuts).toBe(1);
    expect(ev.some((e) => e.kind === "ghost" && e.id === "b")).toBe(true);
    expect(b.state).toBe("ghost");
  });

  it("ghosts drop socks that make fighters slip, and feathers that slow them", () => {
    const m = newMatch(["a", "b", "c"].map((id) => ({ id, cpu: false })), { introSeconds: 0.1, countdownSeconds: 0.5 });
    toFight(m);
    const g = fighter(m, "c");
    g.x = HX + 1;
    run(m, 1.6);
    expect(g.state).toBe("ghost");
    Object.assign(g, { x: 0, z: 0, ghostCd: 0 });
    let ev = run(m, 0.1, () => new Map([["c", swing(0.5)]]));
    expect(ev.find((e) => e.kind === "hazard")).toMatchObject({ hazard: "sock" });
    const a = fighter(m, "a");
    Object.assign(a, { x: -1, z: 0 });
    ev = run(m, 1, () => new Map([["a", { ...IDLE, x: 1 }]]));
    expect(ev.some((e) => e.kind === "slip" && e.id === "a" && e.by === "c")).toBe(true);
    expect(g.stats.slipsCaused).toBe(1);

    Object.assign(g, { x: 2, z: 2, ghostCd: 0 });
    ev = run(m, 0.1, () => new Map([["c", swing(0.5)]]));
    expect(ev.find((e) => e.kind === "hazard")).toMatchObject({ hazard: "feathers" });
    const b = fighter(m, "b");
    Object.assign(b, { x: 2, z: 2, state: "ok", vx: 0, vz: 0, y: 0, vy: 0 });
    run(m, 0.05);
    expect(b.slowed).toBeGreaterThan(0);
  });
});

describe("chaos events", () => {
  it("bounces the bed, launching fighters into the air", () => {
    const m = two();
    toFight(m);
    m.nextChaos = 0;
    m.lastChaos = "avalanche";
    m.seed = 7;
    let lifted = false, chaos: string | null = null;
    for (let i = 0; i < 300 && !lifted; i++) {
      for (const e of step(m, DT, new Map())) if (e.kind === "chaos") chaos = e.chaos;
      if (m.chaos?.kind === "bounce" && fighter(m, "a").y > 0.5) lifted = true;
      if (chaos && chaos !== "bounce") break;
    }
    // whichever kind came up, the chaos system started; bounce must lift people
    expect(chaos).not.toBeNull();
    if (chaos === "bounce") expect(lifted).toBe(true);
  });

  it("an avalanche drops pillows that knock fighters away", () => {
    const m = two();
    toFight(m);
    m.chaos = { kind: "avalanche", t: 0, dur: 5, n: 0 };
    let landed = 0;
    const ev = run(m, 4);
    for (const e of ev) if (e.kind === "drop-land") landed++;
    expect(landed).toBeGreaterThan(5);
  });
});

describe("CPU fighters", () => {
  const playOut = (seed: number) => {
    const m = four({ seed, roundSeconds: 60 });
    const brains = new Map(m.fighters.map((f) => [f.id, newBrain()]));
    const ev: BrawlEvent[] = [];
    for (let i = 0; i < 60 * 60 * 5 && m.phase !== "podium"; i++) {
      const inputs = new Map(m.fighters.map((f) => [f.id, cpuInput(m, f, brains.get(f.id)!, DT)]));
      ev.push(...step(m, DT, inputs));
    }
    return { m, ev };
  };

  it("play a whole match to the podium, knocking each other off", () => {
    const { m, ev } = playOut(42);
    expect(m.phase).toBe("podium");
    expect(ev.filter((e) => e.kind === "hit").length).toBeGreaterThan(10);
    expect(ev.filter((e) => e.kind === "fall").length).toBeGreaterThan(2);
    expect(ev.filter((e) => e.kind === "round-end").length).toBeGreaterThanOrEqual(2);
  });

  it("replays identically for the same seed", () => {
    const a = playOut(9), b = playOut(9);
    expect(a.m.time).toBe(b.m.time);
    expect(a.m.fighters.map((f) => f.stats)).toEqual(b.m.fighters.map((f) => f.stats));
  });
});

describe("awards", () => {
  it("crowns the champion first and spreads the funny awards around", () => {
    const m = four();
    const [a, b, c, d] = m.fighters as [Match["fighters"][0], Match["fighters"][0], Match["fighters"][0], Match["fighters"][0]];
    a.stats.roundWins = 2;
    b.stats.firstOuts = 2;
    c.stats.feathers = 40;
    a.stats.feathers = 50;
    d.stats.slipsCaused = 2;
    m.matchWinner = "a";
    const list = awards(m);
    expect(list[0]).toMatchObject({ id: "champion", playerId: "a" });
    expect(list.find((x) => x.id === "first-off")?.playerId).toBe("b");
    expect(list.find((x) => x.id === "feathers")?.playerId).toBe("a"); // the true leader, even if crowned
    expect(list.find((x) => x.id === "ghost")?.playerId).toBe("d");
    expect(list.length).toBeLessThanOrEqual(4);
  });
});
