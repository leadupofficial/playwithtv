import { describe, expect, it } from "vitest";
import { DT, IDLE, MOVES, PARRY_WINDOW, ROSTER, newMatch, score, standings, step, type KalariEvent, type KalariInput, type Match } from "./engine";
import { knockback } from "./combat";
import { cpuInput, newBrain } from "./cpu";

const two = (o = {}) => newMatch([{ id: "a", cpu: false, char: "ashwa" }, { id: "b", cpu: false, char: "ashwa" }], { introSeconds: 0.1, countdownSeconds: 0.5, ...o });
const four = (o = {}) => newMatch((["simha", "mayil", "puli", "ashwa"] as const).map((char, i) => ({ id: "abcd"[i]!, cpu: true, char })), { introSeconds: 0.1, countdownSeconds: 0.5, ...o });

function toFight(m: Match) {
  while (m.phase !== "fight") step(m, DT, new Map());
}
function run(m: Match, secs: number, inputs: (m: Match, t: number) => Map<string, KalariInput> = () => new Map()) {
  const ev: KalariEvent[] = [];
  for (let t = 0; t < secs; t += DT) ev.push(...step(m, DT, inputs(m, t)));
  return ev;
}
const fighter = (m: Match, id: string) => m.fighters.find((f) => f.id === id)!;
/** `a` at (x, 0) facing +x, `b` right in front of it facing back. */
function faceOff(m: Match, gap = 1.1, x = 0) {
  const a = fighter(m, "a"), b = fighter(m, "b");
  Object.assign(a, { x, z: 0, face: Math.PI / 2, vx: 0, vz: 0 });
  Object.assign(b, { x: x + gap, z: 0, face: -Math.PI / 2, vx: 0, vz: 0 });
  return { a, b };
}
const press = (k: keyof KalariInput): KalariInput => ({ ...IDLE, [k]: true });
const once = (id: string, inp: KalariInput) => new Map([[id, inp]]);

describe("frame data", () => {
  it("every strike has a startup, an active window and a recovery, and the chain is jab → cross → kick", () => {
    for (const mv of Object.values(MOVES)) {
      expect(mv.startup).toBeGreaterThan(0);
      expect(mv.active).toBeGreaterThan(0);
      expect(mv.recovery).toBeGreaterThan(0);
    }
    expect(MOVES.jab.next).toBe("cross");
    expect(MOVES.cross.next).toBe("kick");
    expect(MOVES.kick.next).toBeNull();
    expect(MOVES.heavy.startup).toBeGreaterThan(MOVES.jab.startup * 2); // heavies telegraph
    expect(MOVES.heavy.guardBreak).toBe(true);
  });

  it("four original fighters, each with a named special", () => {
    expect(ROSTER.map((c) => c.id)).toEqual(["simha", "mayil", "puli", "ashwa"]);
    for (const c of ROSTER) expect(c.special.hits.length).toBeGreaterThan(0);
  });
});

describe("strikes", () => {
  it("a jab lands after its startup frames, not before", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m);
    step(m, DT, once("a", press("strike")));
    const early = run(m, MOVES.jab.startup - 2 * DT);
    expect(early.some((e) => e.kind === "hit")).toBe(false);
    const ev = run(m, 0.2);
    const hit = ev.find((e) => e.kind === "hit");
    expect(hit).toMatchObject({ by: "a", on: "b", move: "jab" });
    expect(b.health).toBeLessThan(100);
  });

  it("tap-tap-tap chains jab → cross → kick, and the kick launches", () => {
    const m = two();
    toFight(m);
    faceOff(m, 1.0);
    const ev = run(m, 1.4, (_m, t) => once("a", { ...IDLE, strike: Math.floor(t / DT) % 9 === 0 && t < 0.6 }));
    const moves = ev.filter((e) => e.kind === "attack" && e.id === "a").map((e) => (e as { move: string }).move);
    expect(moves.slice(0, 3)).toEqual(["jab", "cross", "kick"]);
    const hits = ev.filter((e) => e.kind === "hit") as Array<Extract<KalariEvent, { kind: "hit" }>>;
    expect(hits.length).toBe(3);
    expect(hits[2]!.combo).toBe(3);
    expect(hits[2]!.launch).toBe(true);
  });

  it("a strike into nothing whiffs", () => {
    const m = two();
    toFight(m);
    faceOff(m, 4);
    const ev = run(m, 0.5, (_m, t) => once("a", { ...IDLE, strike: t < DT }));
    expect(ev.some((e) => e.kind === "whiff")).toBe(true);
  });

  it("knockback grows as health falls and heavier fighters fly less", () => {
    const m = two();
    const [a, b] = m.fighters as [typeof m.fighters[0], typeof m.fighters[0]];
    const fresh = knockback(10, a, b);
    b.health = 30;
    expect(knockback(10, a, b)).toBeGreaterThan(fresh * 1.5);
    b.health = 100;
    b.char = "simha";
    const heavy = knockback(10, a, b);
    b.char = "puli";
    expect(knockback(10, a, b)).toBeGreaterThan(heavy);
  });
});

describe("guard, parry, roll", () => {
  it("holding GUARD blocks a jab for chip damage only", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m);
    run(m, 0.4, () => once("b", press("guard")));
    const ev = run(m, 0.4, (_m, t) => new Map([["a", { ...IDLE, strike: t < DT }], ["b", press("guard")]]));
    expect(ev.some((e) => e.kind === "block")).toBe(true);
    expect(ev.some((e) => e.kind === "hit")).toBe(false);
    expect(b.health).toBeGreaterThan(98);
  });

  it("pressing GUARD just before a hit parries: the attacker reels", () => {
    const m = two();
    toFight(m);
    const { a, b } = faceOff(m);
    step(m, DT, once("a", press("strike")));
    // guard pressed late, inside the parry window before the jab connects
    const wait = MOVES.jab.startup - PARRY_WINDOW / 2;
    run(m, wait);
    const ev = run(m, 0.3, () => once("b", press("guard")));
    expect(ev.some((e) => e.kind === "parry" && e.by === "b" && e.on === "a")).toBe(true);
    expect(a.state).toBe("stagger");
    expect(b.stats.parries).toBe(1);
  });

  it("tapping GUARD over and over cannot parry nearly every attack: unused presses lock the parry out", () => {
    const m = two();
    toFight(m);
    const { a, b } = faceOff(m);
    let attacks = 0, last = -1;
    const ev = run(m, 8, (_m, t) => {
      const i = Math.round(t / DT);
      faceOff(m); // keep them toe to toe, facing
      const strike = a.state === "ok" && t - last >= 0.5;
      if (strike) { attacks++; last = t; }
      return new Map([["a", { ...IDLE, strike }], ["b", { ...IDLE, guard: i % 4 < 2 }]]); // guard mashed ~15 times a second
    });
    const parries = ev.filter((e) => e.kind === "parry").length;
    expect(attacks).toBeGreaterThan(8);
    expect(parries, `${parries} parries of ${attacks} attacks`).toBeLessThanOrEqual(Math.ceil(attacks * 0.25));
    expect(b.stats.blocks + ev.filter((e) => e.kind === "hit" && e.on === "b").length).toBeGreaterThan(0);
  });

  it("a guard press that parried nothing only blocks for a moment, then a well-timed press parries again", () => {
    const m = two();
    toFight(m);
    const { a } = faceOff(m);
    run(m, 0.05, () => once("b", press("guard"))); // an early, unused press
    run(m, 0.05); // released
    step(m, DT, once("a", press("strike")));
    run(m, MOVES.jab.startup - PARRY_WINDOW / 2);
    let ev = run(m, 0.3, () => once("b", press("guard")));
    expect(ev.some((e) => e.kind === "parry")).toBe(false); // too soon after the unused press: a block
    expect(ev.some((e) => e.kind === "block")).toBe(true);
    run(m, 1.2); // lockout long gone
    faceOff(m);
    expect(a.state).toBe("ok");
    step(m, DT, once("a", press("strike")));
    run(m, MOVES.jab.startup - PARRY_WINDOW / 2);
    ev = run(m, 0.3, () => once("b", press("guard")));
    expect(ev.some((e) => e.kind === "parry" && e.by === "b")).toBe(true);
  });

  it("a heavy breaks a guard", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m, 1.2);
    run(m, 0.4, () => once("b", press("guard")));
    const ev = run(m, 0.8, (_m, t) => new Map([["a", { ...IDLE, heavy: t < DT }], ["b", press("guard")]]));
    expect(ev.some((e) => e.kind === "guard-break")).toBe(true);
    expect(["stagger", "ok", "guard"]).toContain(b.state);
  });

  it("a dodge-roll is invulnerable through its middle", () => {
    const m = two();
    toFight(m);
    const { b } = faceOff(m, 1.1);
    step(m, DT, once("a", press("strike")));
    step(m, DT, once("b", { ...IDLE, roll: true, z: 1 }));
    const ev = run(m, 0.3);
    expect(b.stats.rolls).toBe(1);
    expect(ev.some((e) => e.kind === "hit")).toBe(false);
  });
});

describe("special", () => {
  it("needs a full meter, freezes the action for the cinematic cut, then hits", () => {
    const m = two();
    toFight(m);
    const { a, b } = faceOff(m, 1.5);
    step(m, DT, once("a", press("special")));
    expect(a.state).toBe("ok"); // no meter yet
    a.meter = 100;
    const ev = step(m, DT, once("a", press("special")));
    expect(ev.some((e) => e.kind === "special-start")).toBe(true);
    expect(m.freeze).not.toBeNull();
    const bx = b.x;
    run(m, 0.3);
    expect(b.x).toBe(bx); // frozen
    const after = run(m, 1.6);
    expect(after.some((e) => e.kind === "hit" && e.move === "special")).toBe(true);
    expect(a.meter).toBe(0);
  });

  it("landing hits charges the meter", () => {
    const m = two();
    toFight(m);
    const { a } = faceOff(m, 1.0);
    run(m, 1.4, (_m, t) => once("a", { ...IDLE, strike: Math.floor(t / DT) % 9 === 0 && t < 0.6 }));
    expect(a.meter).toBeGreaterThan(25);
  });
});

describe("ring-outs, KOs and rounds", () => {
  it("knocked off an open edge is a ring-out credited to the hitter", () => {
    const m = two({ arena: "docks" });
    toFight(m);
    const { a, b } = faceOff(m, 1.2, m.arena.hx - 1.6);
    b.health = 20;
    const ev = run(m, 1.5, (_m, t) => once("a", { ...IDLE, heavy: t < DT }));
    expect(ev.some((e) => e.kind === "ringout" && e.id === "b" && e.by === "a")).toBe(true);
    expect(a.stats.ringouts).toBe(1);
    expect(b.alive).toBe(false);
  });

  it("a wall stops the fall instead (and hurts)", () => {
    const m = two({ arena: "courtyard" }); // wall at the back
    toFight(m);
    const a = fighter(m, "a"), b = fighter(m, "b");
    Object.assign(a, { x: 0, z: -m.arena.hz + 1.6, face: Math.PI });
    Object.assign(b, { x: 0, z: -m.arena.hz + 0.6, face: 0, health: 40 });
    const ev = run(m, 1.2, (_m, t) => once("a", { ...IDLE, heavy: t < DT }));
    expect(b.z).toBeGreaterThanOrEqual(-m.arena.hz - 1e-6);
    expect(ev.some((e) => e.kind === "ringout")).toBe(false);
    expect(ev.some((e) => e.kind === "wall")).toBe(true);
  });

  it("health to zero is a KO, and the last one standing wins the round", () => {
    const m = two();
    toFight(m);
    const { a, b } = faceOff(m, 1.0);
    b.health = 3;
    const ev = run(m, 3, (_m, t) => once("a", { ...IDLE, strike: t < DT }));
    expect(ev.some((e) => e.kind === "ko" && e.id === "b" && e.last)).toBe(true);
    expect(ev.some((e) => e.kind === "round-end" && e.winner === "a")).toBe(true);
    expect(a.stats.roundWins).toBe(1);
  });

  it("on time the healthiest fighter wins; a tie is a draw", () => {
    const m = two({ roundSeconds: 2 });
    toFight(m);
    fighter(m, "b").health = 60;
    const ev = run(m, 2.2);
    expect(ev.some((e) => e.kind === "round-end" && e.winner === "a" && e.reason === "time")).toBe(true);
    const n = two({ roundSeconds: 1 });
    toFight(n);
    expect(run(n, 1.2).some((e) => e.kind === "round-end" && e.winner === null)).toBe(true);
  });

  it("best of three: two round wins end the match on the podium; the trailing fighter gets comeback meter", () => {
    const m = two({ roundSeconds: 1 });
    toFight(m);
    fighter(m, "b").health = 50;
    run(m, 5); // round 1 to a, next countdown
    expect(m.round).toBe(2);
    expect(fighter(m, "b").underdog).toBe(true);
    expect(fighter(m, "b").meter).toBeGreaterThanOrEqual(50);
    toFight(m);
    fighter(m, "b").health = 50;
    const ev = run(m, 5);
    expect(m.phase).toBe("podium");
    expect(ev.some((e) => e.kind === "match-end" && e.winner === "a")).toBe(true);
    expect(standings(m)[0]!.id).toBe("a");
    expect(score(fighter(m, "a"))).toBeGreaterThan(score(fighter(m, "b")));
  });
});

describe("CPU", () => {
  it("four CPUs fight a whole match to the podium, with hits, guards and ring-outs or KOs", () => {
    const m = four({ seed: 42, roundSeconds: 45 });
    const brains = new Map(m.fighters.map((f, i) => [f.id, newBrain(11 + i * 7)]));
    const all: KalariEvent[] = [];
    for (let t = 0; t < 400 && m.phase !== "podium"; t += DT) {
      const inputs = new Map(m.fighters.map((f) => [f.id, cpuInput(m, f, brains.get(f.id)!, DT)]));
      all.push(...step(m, DT, inputs));
    }
    expect(m.phase).toBe("podium");
    expect(all.filter((e) => e.kind === "hit").length).toBeGreaterThan(20);
    expect(all.some((e) => e.kind === "block" || e.kind === "parry")).toBe(true);
    expect(all.filter((e) => e.kind === "ko" || e.kind === "ringout").length).toBeGreaterThanOrEqual(3);
    expect(all.some((e) => e.kind === "special-start")).toBe(true);
  });

  it("is deterministic for a seed", () => {
    const play = () => {
      const m = four({ seed: 5, roundSeconds: 20 });
      const brains = new Map(m.fighters.map((f, i) => [f.id, newBrain(3 + i)]));
      for (let t = 0; t < 30; t += DT) step(m, DT, new Map(m.fighters.map((f) => [f.id, cpuInput(m, f, brains.get(f.id)!, DT)])));
      return m.fighters.map((f) => [f.x.toFixed(3), f.health.toFixed(1)].join()).join("|");
    };
    expect(play()).toBe(play());
  });
});
