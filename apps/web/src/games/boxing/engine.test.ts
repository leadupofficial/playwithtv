import { describe, expect, it } from "vitest";
import { NO_CONTROLS, PUNCHES, cpuControls, makeFighter, newBrain, newFight, step, type Controls, type Fight, type FightEvent } from "./engine";

const C = (o: Partial<Controls> = {}): Controls => ({ ...NO_CONTROLS, ...o });

function fight(gap = 180): Fight {
  const f = newFight(makeFighter("a", "A", "#f00", -1, false, 0), makeFighter("b", "B", "#00f", 1, false, 1), 60);
  f.a.x = 600;
  f.b.x = 600 + gap;
  f.phase = "fight";
  return f;
}

/** Runs the fight for `secs`, pressing `a` on the first frame only (one-shot buttons). */
function run(f: Fight, secs: number, a: Partial<Controls> = {}, b: Partial<Controls> = {}, holdB = false): FightEvent[] {
  const ev: FightEvent[] = [];
  const dt = 1 / 60;
  for (let t = 0, i = 0; t < secs; t += dt, i++) {
    const ca = i === 0 ? C(a) : C({ left: a.left, right: a.right, block: a.block });
    const cb = i === 0 || holdB ? C(b) : C({ left: b.left, right: b.right, block: b.block });
    ev.push(...step(f, dt, ca, cb));
  }
  return ev;
}

describe("boxing engine", () => {
  it("a jab in range lands, costs stamina and fills the super meter", () => {
    const f = fight(185);
    const ev = run(f, 0.5, { jab: true });
    expect(ev.find((e) => e.kind === "hit")).toMatchObject({ by: "a", on: "b", punch: "jab" });
    expect(f.b.hp).toBeCloseTo(100 - PUNCHES.jab.dmg, 5);
    expect(f.a.stamina).toBeLessThan(100);
    expect(f.a.superMeter).toBeGreaterThan(0);
  });

  it("an uppercut out of range whiffs", () => {
    const f = fight(420);
    const ev = run(f, 0.8, { upper: true });
    expect(ev.some((e) => e.kind === "whiff")).toBe(true);
    expect(f.b.hp).toBe(100);
  });

  it("blocking takes only chip damage and drains stamina", () => {
    const f = fight(180);
    const ev = run(f, 0.6, { hook: true }, { block: true });
    expect(ev.some((e) => e.kind === "blocked")).toBe(true);
    expect(f.b.hp).toBeGreaterThan(98);
    expect(f.b.stamina).toBeLessThan(100);
  });

  it("a timely dodge slips the punch", () => {
    const f = fight(180);
    const ev = run(f, 0.6, { hook: true }, { dodge: true });
    expect(ev.some((e) => e.kind === "slipped")).toBe(true);
    expect(f.b.hp).toBe(100);
  });

  it("a knocked-down fighter who mashes enough gets up; otherwise it is a KO", () => {
    const f = fight(180);
    f.b.hp = 3;
    run(f, 0.6, { jab: true });
    expect(f.b.state).toBe("down");
    const need = f.b.mashNeeded;
    run(f, 0.5, {}, { mash: need }, false);
    expect(f.b.state).toBe("idle");
    expect(f.b.hp).toBeGreaterThan(0);

    const g = fight(180);
    g.b.hp = 3;
    const ev = run(g, 12, { jab: true });
    expect(ev.find((e) => e.kind === "ko")).toMatchObject({ winner: "a", tko: false });
    expect(g.phase).toBe("over");
  });

  it("three knockdowns is a TKO", () => {
    const f = fight(180);
    f.b.knockdowns = 2;
    f.b.hp = 2;
    const ev = run(f, 0.6, { jab: true });
    expect(ev.find((e) => e.kind === "ko")).toMatchObject({ winner: "a", tko: true });
  });

  it("goes the distance and the judges pick the bigger damage dealer", () => {
    const f = fight(180);
    f.roundSeconds = 1;
    f.clock = 1;
    run(f, 0.6, { jab: true });
    const ev = [...run(f, 1), ...run(f, 5), ...run(f, 1.1), ...run(f, 5), ...run(f, 1.1)];
    expect(f.round).toBe(3);
    expect(ev.find((e) => e.kind === "decision")).toMatchObject({ winner: "a" });
    expect(f.phase).toBe("over");
  });

  it("a tired fighter cannot throw a heavy punch, and super needs a full meter", () => {
    const f = fight(180);
    f.a.stamina = 4;
    run(f, 0.1, { upper: true });
    expect(f.a.state).toBe("idle");
    const g = fight(180);
    run(g, 0.1, { super: true });
    expect(g.a.state).toBe("idle");
    g.a.superMeter = 1;
    const ev = run(g, 0.8, { super: true });
    expect(ev.find((e) => e.kind === "hit")).toMatchObject({ punch: "super", heavy: true });
  });

  it("fighters cannot walk through each other or out of the ring", () => {
    const f = fight(170);
    run(f, 2, { right: true });
    expect(f.b.x - f.a.x).toBeGreaterThanOrEqual(164.9);
    run(f, 6, { left: true });
    expect(f.a.x).toBeGreaterThanOrEqual(190);
  });

  it("the CPU opponent fights back", () => {
    const f = fight(420);
    const brain = newBrain();
    let r = 1;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60 * 20; i++) step(f, 1 / 60, C(), cpuControls(f, f.b, brain, 1 / 60, rand));
    expect(f.b.thrown).toBeGreaterThan(5);
    expect(f.a.hp).toBeLessThan(100);
  });

  it("a landed jab leaves the attacker no frame advantage: the victim recovers first and can answer", () => {
    const f = fight(180);
    const dt = 1 / 60;
    let hitAt = -1, victimFree = -1, attackerFree = -1;
    for (let t = 0, i = 0; t < 1; t += dt, i++) {
      for (const e of step(f, dt, C({ jab: i === 0 }), C())) if (e.kind === "hit") hitAt = t;
      if (hitAt >= 0 && victimFree < 0 && f.b.state === "idle") victimFree = t;
      if (hitAt >= 0 && attackerFree < 0 && f.a.state === "idle") attackerFree = t;
    }
    expect(hitAt).toBeGreaterThan(0);
    expect(victimFree).toBeLessThanOrEqual(attackerFree);
  });

  it("mirror jab spam is a trade, not a loop: the fighter hit first still lands punches back", () => {
    for (const gap of [170, 200, 230]) {
      const f = fight(gap);
      f.roundSeconds = f.clock = 20;
      const dt = 1 / 60;
      const landed = { a: 0, b: 0 };
      for (let t = 0; t < 15 && f.phase === "fight"; t += dt) {
        // both mash jab every frame (A gets the first press in)
        for (const e of step(f, dt, C({ jab: true }), C({ jab: t > dt }))) if (e.kind === "hit") landed[e.by as "a" | "b"]++;
        f.a.stamina = f.b.stamina = 100; // isolate the timing from tiredness
      }
      expect(landed.a, `gap ${gap}`).toBeGreaterThan(3);
      expect(landed.b, `gap ${gap}: ${landed.a}-${landed.b}`).toBeGreaterThanOrEqual(landed.a * 0.5);
    }
  });

  it("the CPU gets up at a human tapping rate, the same at any frame rate", () => {
    for (const fps of [30, 60, 120]) {
      const f = fight(180);
      f.b.cpu = true;
      f.b.hp = 3;
      run(f, 0.6, { jab: true });
      expect(f.b.state).toBe("down");
      const brain = newBrain();
      let r = 1;
      const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
      let taps = 0;
      for (let t = 0; t < 1; t += 1 / fps) taps += cpuControls(f, f.b, brain, 1 / fps, rand).mash;
      expect(taps, `${fps} fps`).toBeGreaterThanOrEqual(4);
      expect(taps, `${fps} fps`).toBeLessThanOrEqual(10); // a quick human thumb: no 33 taps a second
    }
  });
});
